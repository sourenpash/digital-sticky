// Reads and changes the board's settings file, .env (readable only by you). Used by
// `npm run pin` and scripts/linux/anywhere.sh:
//   node scripts/envFile.ts set KEY VALUE
//   node scripts/envFile.ts unset KEY
import { readFile, rename, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const ENV_FILE = '.env';

function lineFor(key: string): RegExp {
  return new RegExp(`^\\s*${key}\\s*=`);
}

/** The file's lines (none if there's no file yet). */
export async function readEnv(file = ENV_FILE): Promise<string[]> {
  try {
    return (await readFile(file, 'utf8')).split('\n').filter((line, i, all) => line !== '' || i < all.length - 1);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Replaces the file in one step, readable only by you. */
export async function writeEnv(lines: string[], file = ENV_FILE): Promise<void> {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, lines.length ? `${lines.join('\n')}\n` : '', { mode: 0o600, flag: 'wx' });
  await rename(temp, file);
}

/** Sets `key` to `value` (replacing any earlier lines for it), or removes it when `value` is null. */
export async function setEnv(key: string, value: string | null, file = ENV_FILE): Promise<void> {
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error(`Not a setting name: ${key}`);
  if (value !== null && /[\r\n]/.test(value)) throw new Error('A setting is one line');
  const kept = (await readEnv(file)).filter(line => !lineFor(key).test(line));
  await writeEnv(value === null ? kept : [...kept, `${key}=${value}`], file);
}

// Run from the command line.
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const [command, key, value] = process.argv.slice(2);
  try {
    if (command === 'set' && key && value !== undefined) await setEnv(key, value);
    else if (command === 'unset' && key) await setEnv(key, null);
    else {
      console.error('Usage: node scripts/envFile.ts set KEY VALUE | unset KEY');
      process.exit(2);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
