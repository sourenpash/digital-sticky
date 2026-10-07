import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setEnv } from './envFile.ts';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-env-'));
  file = join(dir, '.env');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('the .env file', () => {
  it('sets a value, replacing earlier ones and keeping the rest', async () => {
    await writeFile(file, '# my settings\nBOARD_PIN=482915\nPUBLIC_URL=http://nuc.local:3000\n PUBLIC_URL = http://old\n');
    await setEnv('PUBLIC_URL', 'https://nuc.tail1234.ts.net', file);
    expect(await readFile(file, 'utf8')).toBe('# my settings\nBOARD_PIN=482915\nPUBLIC_URL=https://nuc.tail1234.ts.net\n');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('removes a value, and starts a new file when there’s none', async () => {
    await setEnv('BOARD_PIN', '482915', file);
    await setEnv('PUBLIC_URL', 'https://nuc.tail1234.ts.net', file);
    await setEnv('BOARD_PIN', null, file);
    expect(await readFile(file, 'utf8')).toBe('PUBLIC_URL=https://nuc.tail1234.ts.net\n');
  });

  it('refuses names and values that would break the file', async () => {
    await expect(setEnv('lower', 'x', file)).rejects.toThrow();
    await expect(setEnv('A=B', 'x', file)).rejects.toThrow();
    await expect(setEnv('PUBLIC_URL', 'x\nBOARD_PIN=1', file)).rejects.toThrow();
  });
});
