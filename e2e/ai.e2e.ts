import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { Locator, Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { Harness } from './harness.ts';

// The AI helper end to end, without an AI: the board wakes a Claude routine (a stand-in
// that only records the request), and an MCP client plays the AI, reading its task and
// reporting back. The wall and the phone show what happened.

const h = new Harness(makeEmptyBoard);
const ROUTINE = 'https://routines.test/v1/claude_code/routines/trig_01TEST/fire';
const TOKEN = 'sk-ant-oat01-stand-in-token-abcd';

/** The words as written (the wall shows some of them in capitals). */
const text = (locator: Locator) => () => locator.first().textContent().catch(() => '');

beforeAll(() => h.launch());
afterAll(() => h.close());
beforeEach(() => h.setUp());
afterEach(async () => {
  await h.tearDown();
  expect(h.pageErrors).toEqual([]);
});

/** Wall tab: let an AI connect, and add the Claude routine. */
async function addRoutine(phone: Page): Promise<void> {
  await phone.getByRole('switch', { name: 'Let an AI connect to the board' }).click();
  await phone.getByRole('button', { name: 'Add an AI' }).click();
  await phone.getByRole('radio', { name: /Claude routine/ }).click();
  const form = phone.getByRole('form', { name: 'Add Claude routine' });
  await form.getByLabel(/API trigger address/).fill(ROUTINE);
  await form.getByLabel('Token').fill(TOKEN);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await phone.locator('.ai-conn', { hasText: 'Claude routine' }).getByText('Default').waitFor();
}

/** The MCP client playing the AI, connected with the link from the Wall tab. */
async function connectAi(): Promise<Client> {
  const secret = (await readFile(join(h.dataDir, 'mcp-secret'), 'utf8')).trim();
  const client = new Client({ name: 'claude-ai', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${h.port}/mcp/${secret}`)));
  return client;
}

const reply = (result: Awaited<ReturnType<Client['callTool']>>) => (result.content as Array<{ text: string }>)[0]!.text;

describe('the AI helper', () => {
  it('wakes the AI when a sticky is due, and shows its report on the wall', async () => {
    const wall = await h.open('wall', 'wall');
    const phone = await h.open('phone', 'display');
    await addRoutine(phone);
    // The link shown is the one AIs connect to.
    const shown = await phone.locator('.copy-box', { hasText: 'Link' }).locator('.copy-text').innerText();
    expect(shown).toMatch(/\/mcp\/[A-Za-z0-9_-]{43}$/);

    // A to-do handed to the AI, then Run now.
    await phone.getByRole('button', { name: 'Board', exact: true }).click();
    await phone.getByRole('button', { name: 'Add a note' }).click();
    await phone.getByRole('button', { name: /^To-do/ }).click();
    await phone.getByLabel('Title').fill('Check grants.gov for new calls');
    await phone.getByRole('button', { name: 'Give this to AI' }).click();
    await phone.getByRole('dialog').getByRole('button', { name: 'Add to board' }).click();
    const sticky = wall.locator('.note', { hasText: 'Check grants.gov for new calls' });
    await sticky.waitFor({ timeout: 5000 });
    await phone.getByRole('button', { name: /Check grants\.gov for new calls/ }).first().click();
    await phone.getByRole('button', { name: 'Run now' }).click();

    // The board woke the routine, saying which sticky is due.
    await expect.poll(() => h.wakeUps.length, { timeout: 5000 }).toBe(1);
    const [wake] = h.wakeUps;
    const id = h.server!.store.board.notes.find(n => n.title === 'Check grants.gov for new calls')!.id;
    expect(wake!.url).toBe(ROUTINE);
    expect(wake!.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}`, 'anthropic-version': '2023-06-01' });
    expect(wake!.body.text).toContain(`"Check grants.gov for new calls" (sticky ${id})`);
    await phone.locator('.ai-status', { hasText: /Asked Claude routine .+\. Waiting for its report\./ }).getByRole('link', { name: /Open the run/ }).waitFor();

    // The AI picks it up: the wall says it's being checked.
    const ai = await connectAi();
    try {
      const tasks = JSON.parse(reply(await ai.callTool({ name: 'list_ai_tasks', arguments: {} }))) as { tasks: Array<{ stickyId: string }> };
      expect(tasks.tasks.map(task => task.stickyId)).toEqual([id]);
      await expect.poll(text(sticky.locator('.note-stage'))).toBe('AI · checking now');
      await phone.getByText('Claude is working on it now.').waitFor();

      // It reports back, with a new sticky for what it found.
      const saved = reply(
        await ai.callTool({
          name: 'report_ai_run',
          arguments: {
            stickyId: id,
            summary: 'One new call: NIH K99/R00, due Feb 12. Nothing new on NSF.',
            links: [{ url: 'https://grants.nih.gov/k99', label: 'NIH' }],
            newStickies: [{ title: 'NIH K99/R00 award', details: 'Check the eligibility window.', due: '2027-02-12' }],
          },
        }),
      );
      expect(saved).toBe('Saved on "Check grants.gov for new calls". Added a sticky: "NIH K99/R00 award".');
    } finally {
      await ai.close();
    }

    // The wall shows the check and the new sticky, in Double-check.
    await expect.poll(text(sticky.locator('.note-stage'))).toMatch(/^AI · checked \d{1,2}(:\d{2})? (AM|PM)$/);
    const found = wall.locator('.note', { hasText: 'NIH K99/R00 award' });
    await found.waitFor({ timeout: 5000 });
    expect(await found.locator('.note-stage').textContent()).toBe('Found by AI');
    expect(await wall.locator('.wall-col', { has: found }).locator('.wall-col-title').innerText()).toMatch(/double-check/i);
    // And the phone, the report.
    await phone.locator('.ai-run', { hasText: 'One new call: NIH K99/R00' }).getByRole('link', { name: /NIH/ }).waitFor();
    await phone.locator('.ai-run').getByRole('button', { name: 'NIH K99/R00 award' }).waitFor();
  });

  it('sends a test, and never shows the token again', async () => {
    const phone = await h.open('phone', 'display');
    await addRoutine(phone);
    const row = phone.locator('.ai-conn', { hasText: 'Claude routine' });
    await row.getByRole('button', { name: 'Send a test to Claude routine' }).click();
    await row.getByText('This wakes Claude routine once: one routine run, on your Claude plan.').waitFor();
    await row.getByRole('button', { name: 'Send the test' }).click();
    await row.getByText('Claude routine was woken up.').waitFor();
    expect(h.wakeUps).toHaveLength(1);
    expect(String(h.wakeUps[0]!.body.text)).toContain('this is a test');
    await row.getByText(/^Woken /).waitFor();

    // The token stays on the wall computer: the app shows only its end.
    await phone.reload();
    await row.getByRole('button', { name: 'Change Claude routine' }).click();
    expect(await phone.getByLabel('Token').getAttribute('placeholder')).toBe('Saved, ends in abcd. Paste a new one to change it.');
    expect(await phone.content()).not.toContain(TOKEN);
    const overview = await phone.evaluate(async () => (await fetch('api/ai')).text());
    expect(overview).not.toContain(TOKEN);
  });
});
