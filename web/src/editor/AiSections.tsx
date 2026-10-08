import { useState, type ReactNode } from 'react';
import { parseISO } from 'date-fns';
import { Bot, ChevronRight, ExternalLink, Pencil, Plus, Send, Sparkles, Trash2, TriangleAlert, Webhook, Workflow } from 'lucide-react';
import { AI_AGENT_PROMPT, AI_KIND_LABEL, describeAiSchedule, whenLabel, type AiConnectionKind } from '../../../shared/ai.ts';
import type { AiConnectionInfo, AiOverview, AiTestResult } from '../../../shared/api.ts';
import type { Board } from '../../../shared/types.ts';
import { newMcpLink, removeConnection, saveConnection, testConnection, useAi } from '../store/ai.ts';
import { board as store } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';
import { uid } from '../lib/uid.ts';
import { CopyBox } from './CopyBox.tsx';
import { Switch } from './Switch.tsx';

// The Wall tab's AI helper: letting an AI connect to the board (over MCP), the AIs the
// board wakes up when a sticky is due, step-by-step setup for each kind, and the
// stickies handed to it.

const DAILY_CAPS = [4, 12, 24, 48];

const KIND_ICON: Record<AiConnectionKind, typeof Bot> = { routine: Sparkles, openclaw: Bot, webhook: Webhook, self: Workflow };

const DEFAULT_NAME: Record<AiConnectionKind, string> = { routine: 'Claude routine', openclaw: 'OpenClaw', webhook: 'Webhook', self: 'Claude Code' };

const KIND_HINT: Record<AiConnectionKind, string> = {
  routine: 'Runs in the cloud on your Claude plan. Good for daily web checks.',
  openclaw: 'Your own AI agent, on a Mac or PC.',
  webhook: 'n8n, Zapier, Make, or your own script.',
  self: 'An AI that runs on its own schedule, like Claude Code. The board never wakes it.',
};

/**
 * The board's links for AIs: from anywhere, and on the Wi-Fi. When the wall computer
 * doesn't know its Wi-Fi address, this app's own address stands in.
 */
function mcpLinks(overview: AiOverview): { anywhere: string | null; home: string | null } {
  const { anywhere, home, path } = overview.mcp;
  const own = path ? new URL(path.replace(/^\//, ''), document.baseURI).href : null;
  return { anywhere, home: home ?? (own && own !== anywhere ? own : null) };
}

/** The board's MCP link: what AIs connect to. */
function McpLinks({ overview, now }: { overview: AiOverview; now: Date }) {
  const [confirming, setConfirming] = useState(false);
  const { anywhere, home } = mcpLinks(overview);
  const remake = async () => {
    setConfirming(false);
    if (await newMcpLink()) showToast({ text: 'New link made. Paste it into the AIs that use the board.' });
    else showToast({ text: 'Couldn’t make a new link. Check the connection and try again.' });
  };
  return (
    <div className="ai-links">
      <p className="set-note">
        AIs connect to the board with this link. Keep it private: with it, an AI can read the board and report on the stickies handed to it (it can’t delete
        anything).
      </p>
      {anywhere && <CopyBox label="Link from anywhere" text={anywhere} />}
      {home && home !== anywhere && <CopyBox label={anywhere ? 'Link on your Wi-Fi' : 'Link (on your Wi-Fi)'} text={home} />}
      {!anywhere && (
        <p className="set-note">
          Claude routines run in the cloud, so they need the board’s internet address: run <code>scripts/linux/anywhere.sh</code> on the wall computer first.
        </p>
      )}
      <p className="set-note">{overview.lastUsed ? `Last used by ${overview.lastUsed.client}, ${whenLabel(parseISO(overview.lastUsed.at), now)}.` : 'No AI has used it yet.'}</p>
      {confirming ? (
        <div className="screen-confirm" role="group" aria-label="Make a new link?">
          <span>AIs using this link stop getting in until you give them the new one.</span>
          <span className="set-row">
            <button type="button" className="btn btn-sm btn-danger" onClick={() => void remake()}>
              Make a new link
            </button>
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(false)}>
              Keep this one
            </button>
          </span>
        </div>
      ) : (
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setConfirming(true)}>
          Make a new link
        </button>
      )}
    </div>
  );
}

/** The best link for an AI that runs elsewhere (anywhere), or on the home Wi-Fi. */
const linkFor = (overview: AiOverview) => {
  const { anywhere, home } = mcpLinks(overview);
  return anywhere ?? home ?? '';
};

/** How to set up each kind, step by step. */
function SetupSteps({ kind, overview }: { kind: AiConnectionKind; overview: AiOverview }) {
  const link = linkFor(overview);
  const steps: ReactNode[] = [];
  if (kind === 'routine') {
    steps.push(
      overview.mcp.anywhere ? (
        <>
          In Claude, open <strong>Settings → Connectors</strong> and add a custom connector named <strong>Sticky Wall</strong>, with this link:
          <CopyBox label="Connector link" text={overview.mcp.anywhere} />
        </>
      ) : (
        <span className="ai-warn">
          <TriangleAlert aria-hidden="true" /> First give the board an internet address: run <code>scripts/linux/anywhere.sh</code> on the wall computer. Claude runs in the
          cloud, so it can’t reach your Wi-Fi.
        </span>
      ),
      <>
        Make a routine in Claude Code on the web, with this as its prompt. Give it the Sticky Wall connector, and <strong>Full</strong> network access so it can read
        websites.
        <CopyBox label="Routine prompt" text={AI_AGENT_PROMPT} multiline />
      </>,
      <>
        Add an <strong>API trigger</strong> to the routine, and paste its address and token below. Each wake-up is one routine run, on your Claude plan.
      </>,
    );
  } else if (kind === 'openclaw') {
    steps.push(
      <>
        On the computer with OpenClaw, add the board as an MCP server:
        <CopyBox label="Command" text={`openclaw mcp add sticky-wall --url ${link} --transport streamable-http`} />
      </>,
      <>
        Turn on OpenClaw’s webhooks (<code>hooks.enabled</code>, with a <code>hooks.token</code>), then paste its address (like <code>http://mac-mini.local:18789</code>)
        and that token below. The board tells it what’s due and what to do.
      </>,
    );
  } else if (kind === 'webhook') {
    steps.push(
      <>
        When stickies are due, the board posts JSON to your address: <code>event</code> (<code>ai.tasks_due</code>), the <code>tasks</code>, the board’s{' '}
        <code>mcpUrl</code> and a <code>prompt</code> for the AI.
      </>,
      <>
        With a secret, each post is signed: <code>X-Sticky-Signature: sha256=…</code> is an HMAC-SHA256 of the body with the secret.
      </>,
    );
  } else {
    steps.push(
      <>
        Add the board to the AI as an MCP server, with the link. For Claude Code:
        <CopyBox label="Command" text={`claude mcp add --transport http sticky-wall ${link}`} />
      </>,
      <>
        Have it run on its own schedule (every hour, say) with this prompt. Each time, it asks the board what’s due.
        <CopyBox label="Prompt" text={AI_AGENT_PROMPT} multiline />
      </>,
    );
  }
  return (
    <ol className="ai-steps">
      {steps.map((step, i) => (
        <li key={i}>{step}</li>
      ))}
    </ol>
  );
}

const FIELDS: Record<AiConnectionKind, { url?: { label: string; placeholder: string }; token?: { label: string; placeholder: string; optional?: boolean } }> = {
  routine: {
    url: { label: 'Routine’s API trigger address', placeholder: 'https://api.anthropic.com/v1/claude_code/routines/trig_…/fire' },
    token: { label: 'Token', placeholder: 'sk-ant-oat01-…' },
  },
  openclaw: { url: { label: 'OpenClaw’s address', placeholder: 'http://mac-mini.local:18789' }, token: { label: 'Hook token', placeholder: 'The hooks.token from its settings' } },
  webhook: { url: { label: 'Webhook address', placeholder: 'https://…' }, token: { label: 'Secret for signing', placeholder: 'Optional', optional: true } },
  self: {},
};

/** Adding an AI, or changing one. */
function ConnectionEditor({ overview, editing, onDone }: { overview: AiOverview; editing: AiConnectionInfo | null; onDone: () => void }) {
  const [kind, setKind] = useState<AiConnectionKind | null>(editing?.kind ?? null);
  const [name, setName] = useState(editing?.name ?? '');
  const [url, setUrl] = useState(editing?.url ?? '');
  const [token, setToken] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!kind) {
    return (
      <div className="ai-editor" role="group" aria-label="Add an AI">
        <span className="field-label" id="ai-kind">
          How should the board reach it?
        </span>
        <div className="radio-cards radio-cards-stack" role="radiogroup" aria-labelledby="ai-kind">
          {(Object.keys(AI_KIND_LABEL) as AiConnectionKind[]).map(option => {
            const Icon = KIND_ICON[option];
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={false}
                className="radio-card ai-kind-card"
                onClick={() => {
                  setKind(option);
                  setName(DEFAULT_NAME[option]);
                }}
              >
                <span className="radio-card-title">
                  <Icon aria-hidden="true" /> {AI_KIND_LABEL[option]}
                </span>
                <span className="radio-card-hint">{KIND_HINT[option]}</span>
              </button>
            );
          })}
        </div>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    );
  }

  const fields = FIELDS[kind];
  const keepsToken = editing?.kind === kind && editing.tokenEnd !== null;
  const save = async () => {
    setBusy(true);
    setError(null);
    const problem = await saveConnection(
      editing?.id ?? uid(),
      {
        kind,
        name: name.trim(),
        ...(fields.url ? { url: url.trim() } : {}),
        // Left empty while editing: keep the saved token.
        ...(fields.token && (token.trim() || !keepsToken) ? { token: token.trim() } : {}),
        ...(makeDefault ? { makeDefault: true } : {}),
      },
      editing?.tokenEnd ?? undefined,
    );
    setBusy(false);
    if (problem) {
      setError(problem);
      return;
    }
    showToast({ text: editing ? `Saved “${name.trim()}”.` : `Added “${name.trim()}”. Send a test to check it works.` });
    onDone();
  };

  return (
    <form
      className="ai-editor"
      aria-label={editing ? `Change ${editing.name}` : `Add ${AI_KIND_LABEL[kind]}`}
      onSubmit={e => {
        e.preventDefault();
        void save();
      }}
    >
      <h4 className="ai-editor-title">{editing ? `Change “${editing.name}”` : AI_KIND_LABEL[kind]}</h4>
      <SetupSteps kind={kind} overview={overview} />
      <label className="field" htmlFor="ai-conn-name">
        <span className="field-label">Name</span>
        <input id="ai-conn-name" value={name} maxLength={60} onChange={e => setName(e.target.value)} />
      </label>
      {fields.url && (
        <label className="field" htmlFor="ai-conn-url">
          <span className="field-label">{fields.url.label}</span>
          <input id="ai-conn-url" value={url} inputMode="url" autoComplete="off" spellCheck={false} placeholder={fields.url.placeholder} onChange={e => setUrl(e.target.value)} />
        </label>
      )}
      {fields.token && (
        <label className="field" htmlFor="ai-conn-token">
          <span className="field-label">{fields.token.label}</span>
          <input
            id="ai-conn-token"
            type="password"
            value={token}
            autoComplete="off"
            spellCheck={false}
            placeholder={keepsToken ? `Saved, ends in ${editing!.tokenEnd}. Paste a new one to change it.` : fields.token.placeholder}
            onChange={e => setToken(e.target.value)}
          />
        </label>
      )}
      {overview.connections.length > 0 && !editing?.isDefault && (
        <label className="check-row">
          <input type="checkbox" checked={makeDefault} onChange={e => setMakeDefault(e.target.checked)} />
          <span>Use it for stickies that don’t choose one</span>
        </label>
      )}
      {error && (
        <p className="ne-error" role="alert">
          {error}
        </p>
      )}
      <div className="set-row">
        <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !name.trim()}>
          {editing ? 'Save' : 'Add'}
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** How the last wake-up went: "Woken 8 AM", or what's wrong. */
function wakeLabel(connection: AiConnectionInfo, now: Date): string {
  if (connection.kind === 'self') return 'Checks in on its own';
  if (connection.problem) return connection.problem;
  const last = connection.lastWake;
  if (!last) return 'Not woken yet';
  const when = whenLabel(parseISO(last.at), now);
  return last.ok ? `Woken ${when}` : `${when}: ${last.message}`;
}

function ConnectionRow({ connection, now, onEdit }: { connection: AiConnectionInfo; now: Date; onEdit: () => void }) {
  const [mode, setMode] = useState<'view' | 'test' | 'remove'>('view');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiTestResult | null>(null);
  const Icon = KIND_ICON[connection.kind];
  const lastRun = connection.lastWake?.ok ? connection.lastWake.url : undefined;

  const test = async () => {
    setBusy(true);
    setResult(await testConnection(connection.id));
    setBusy(false);
    setMode('view');
  };
  const remove = async () => {
    setBusy(true);
    const ok = await removeConnection(connection.id);
    setBusy(false);
    showToast({ text: ok ? `Removed “${connection.name}”.` : 'Couldn’t remove it. Check the connection and try again.' });
  };

  return (
    <li className="screen-row ai-conn">
      <Icon className="ai-conn-icon" aria-hidden="true" />
      <span className="screen-text">
        <span className="screen-name">
          {connection.name}
          {connection.isDefault && <span className="screen-tag">Default</span>}
        </span>
        {connection.name.trim().toLowerCase() !== AI_KIND_LABEL[connection.kind].toLowerCase() && <span className="screen-hint">{AI_KIND_LABEL[connection.kind]}</span>}
        <span className={`screen-hint${connection.problem || connection.lastWake?.ok === false ? ' is-warn' : ''}`}>
          {wakeLabel(connection, now)}
          {lastRun && (
            <>
              {' · '}
              <a href={lastRun} target="_blank" rel="noopener noreferrer">
                Open the run <ExternalLink aria-hidden="true" className="inline-icon" />
              </a>
            </>
          )}
        </span>
        {result && (
          <span className={`ai-test-result${result.ok ? ' is-ok' : ' is-warn'}`} role="status">
            {result.message}
          </span>
        )}
        {mode === 'test' && (
          <span className="screen-confirm" role="group" aria-label={`Send a test to ${connection.name}?`}>
            <span>
              This wakes {connection.name} once{connection.kind === 'routine' ? ': one routine run, on your Claude plan' : ''}. Nothing on the board changes.
            </span>
            <span className="set-row">
              <button type="button" className="btn btn-sm btn-primary" disabled={busy} onClick={() => void test()}>
                {busy ? 'Sending…' : 'Send the test'}
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode('view')}>
                Cancel
              </button>
            </span>
          </span>
        )}
        {mode === 'remove' && (
          <span className="screen-confirm" role="group" aria-label={`Remove ${connection.name}?`}>
            <span>The board stops waking it. Stickies it did go to the default one.</span>
            <span className="set-row">
              <button type="button" className="btn btn-sm btn-danger" disabled={busy} onClick={() => void remove()}>
                Remove
              </button>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => setMode('view')}>
                Cancel
              </button>
            </span>
          </span>
        )}
      </span>
      {mode === 'view' && (
        <span className="screen-actions">
          {connection.kind !== 'self' && (
            <button type="button" className="icon-btn icon-btn-sm" aria-label={`Send a test to ${connection.name}`} title="Send a test" onClick={() => setMode('test')}>
              <Send />
            </button>
          )}
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Change ${connection.name}`} title="Change" onClick={onEdit}>
            <Pencil />
          </button>
          <button type="button" className="icon-btn icon-btn-sm" aria-label={`Remove ${connection.name}`} title="Remove" onClick={() => setMode('remove')}>
            <Trash2 />
          </button>
        </span>
      )}
    </li>
  );
}

/** The Wall tab's AI helper section. */
export function AiHelperSection({ board, now, go }: { board: Board; now: Date; go: (token: string) => void }) {
  const overview = useAi();
  const [editing, setEditing] = useState<AiConnectionInfo | 'new' | null>(null);
  const settings = board.settings.ai;
  const handed = board.notes.filter(note => note.ai && !note.done);
  const setAi = (patch: Partial<Board['settings']['ai']>) => store.updateSettings(s => ({ ...s, ai: { ...s.ai, ...patch } }));

  return (
    <section className="set-group" id="ai-helper">
      <h3>
        <Sparkles aria-hidden="true" /> AI helper
      </h3>
      <p className="set-note">
        Give any sticky to an AI with <strong>Give this to AI</strong> in its menu. It looks things up on the schedule you pick, reports back on the sticky, and can add
        stickies for new things it finds. Any AI that speaks MCP can do it: Claude, OpenClaw, and others.
      </p>
      <Switch id="ai-connect" checked={settings.connect} label="Let an AI connect to the board" onChange={connect => setAi({ connect })} />
      {settings.connect &&
        (overview ? (
          <>
            <McpLinks overview={overview} now={now} />
            <h4 className="set-subhead">AIs the board wakes up</h4>
            <p className="set-note">When a sticky is due, the board tells the AI that does it, which then connects and reports back.</p>
            {overview.connections.length > 0 && (
              <ul className="screen-list">
                {overview.connections.map(connection => (
                  <ConnectionRow key={connection.id} connection={connection} now={now} onEdit={() => setEditing(connection)} />
                ))}
              </ul>
            )}
            {editing ? (
              <ConnectionEditor key={editing === 'new' ? 'new' : editing.id} overview={overview} editing={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
            ) : (
              <button type="button" className="btn btn-sm" onClick={() => setEditing('new')}>
                <Plus aria-hidden="true" /> {overview.connections.length ? 'Add another AI' : 'Add an AI'}
              </button>
            )}
            <div className="sym-field">
              <span className="field-label" id="ai-cap">
                Wake-ups a day, at most
              </span>
              <div className="seg-group" role="radiogroup" aria-labelledby="ai-cap">
                {DAILY_CAPS.map(cap => (
                  <button key={cap} type="button" role="radio" aria-checked={settings.dailyCap === cap} className={`seg${settings.dailyCap === cap ? ' is-on' : ''}`} onClick={() => setAi({ dailyCap: cap })}>
                    {cap}
                  </button>
                ))}
              </div>
              <p className="set-note">
                {overview.wakesToday} so far today. {overview.wakesToday >= settings.dailyCap ? 'That’s the limit: the rest wait until tomorrow.' : 'A Claude routine run uses some of your plan.'}
              </p>
            </div>
          </>
        ) : (
          <p className="set-note">Checking…</p>
        ))}
      <h4 className="set-subhead">Stickies handed to it</h4>
      {handed.length > 0 ? (
        <ul className="ai-list">
          {handed.map(note => {
            const last = note.aiLog?.[0];
            return (
              <li key={note.id}>
                <button type="button" className="remote-card ai-card" onClick={() => go(`note-${note.id}`)}>
                  <Sparkles aria-hidden="true" />
                  <span className="remote-card-text">
                    <span className="remote-card-title">{note.title || 'Untitled note'}</span>
                    <span className="remote-card-hint">
                      {note.ai ? describeAiSchedule(note.ai) : ''}
                      {last ? ` · checked ${whenLabel(parseISO(last.at), now)}` : ''}
                    </span>
                  </span>
                  <ChevronRight aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="set-note">None yet.</p>
      )}
      {__DEMO_BUILD__ && <p className="set-note">In this preview the AI updates are samples, and nothing is sent anywhere.</p>}
    </section>
  );
}
