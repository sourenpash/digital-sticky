// Sets the board's PIN, or removes it: `npm run pin` / `npm run pin -- --off`.
// The PIN goes in .env (readable only by you). On a wall computer set up with
// scripts/linux/install.sh, the board restarts to use it; otherwise restart it yourself.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const ENV_FILE = '.env';
const PIN_LINE = /^\s*BOARD_PIN\s*=/;

async function readEnv(): Promise<string[]> {
  try {
    return (await readFile(ENV_FILE, 'utf8')).split('\n').filter((line, i, all) => line !== '' || i < all.length - 1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

async function writeEnv(lines: string[]): Promise<void> {
  const temp = `${ENV_FILE}.${process.pid}.tmp`;
  await writeFile(temp, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600, flag: 'wx' });
  await rename(temp, ENV_FILE);
}

/** Lines typed or piped in. Typed ones aren't shown on screen. */
function makePrompt(): { ask: (question: string) => Promise<string>; close: () => void } {
  if (process.stdin.isTTY) {
    return {
      ask: question =>
        new Promise(resolve => {
          process.stdout.write(question);
          let text = '';
          process.stdin.setRawMode(true);
          process.stdin.resume();
          const onData = (chunk: Buffer) => {
            for (const ch of chunk.toString('utf8')) {
              if (ch === '\u0003') process.exit(130); // Ctrl+C
              if (ch === '\r' || ch === '\n') {
                process.stdin.off('data', onData);
                process.stdin.setRawMode(false);
                process.stdin.pause();
                process.stdout.write('\n');
                resolve(text);
                return;
              }
              if (ch === '\u007f' || ch === '\b') text = text.slice(0, -1);
              else text += ch;
            }
          };
          process.stdin.on('data', onData);
        }),
      close: () => {},
    };
  }
  const lines = createInterface({ input: process.stdin })[Symbol.asyncIterator]();
  return {
    ask: async question => {
      process.stdout.write(question);
      const next = await lines.next();
      process.stdout.write('\n');
      return next.done ? '' : next.value;
    },
    close: () => void lines.return?.(),
  };
}

/** Restarts the board's service (from install.sh) so the change applies, or says how to. */
function restartBoard(): void {
  // The installer restarts the board itself once it's set up.
  if (process.argv.includes('--no-restart')) return;
  const unit = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'systemd', 'user', 'sticky-wall.service');
  if (existsSync(unit)) {
    try {
      execFileSync('systemctl', ['--user', 'restart', 'sticky-wall.service'], { stdio: 'ignore' });
      console.log('The board restarted with the change.');
      return;
    } catch {
      // Say how to do it by hand, below.
    }
  }
  console.log('Restart the board to use it: stop it with Ctrl+C, then npm start (or: systemctl --user restart sticky-wall).');
}

const kept = (await readEnv()).filter(line => !PIN_LINE.test(line));

if (process.argv.includes('--off')) {
  await writeEnv(kept);
  console.log('PIN removed: anyone on your Wi-Fi can open the board.');
  restartBoard();
  process.exit(0);
}

const prompt = makePrompt();
const pin = (await prompt.ask('New PIN (6 to 12 digits): ')).trim();
if (!/^\d{6,12}$/.test(pin)) {
  prompt.close();
  console.error('A PIN is 6 to 12 digits, like an iPhone passcode. Nothing was changed.');
  process.exit(1);
}
const again = (await prompt.ask('The same PIN again: ')).trim();
prompt.close();
if (again !== pin) {
  console.error("Those didn't match. Nothing was changed.");
  process.exit(1);
}
await writeEnv([...kept, `BOARD_PIN=${pin}`]);
console.log("PIN saved. Each phone or computer asks for it once; the wall computer itself doesn't need it.");
restartBoard();
