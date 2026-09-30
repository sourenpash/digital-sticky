import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { makeSampleBoard } from '../shared/sample.ts';
import { connectUrlFor, readConfig } from './config.ts';
import { startServer } from './server.ts';

// Starts the board server: `npm start` (or `npm run demo` for the sample board).

try {
  process.loadEnvFile();
} catch {
  // No .env file: defaults and real environment variables are used.
}

const config = readConfig(process.env, process.argv.slice(2));
const staticDir = resolve('dist/web');
const hasApp = existsSync(join(staticDir, 'index.html'));

function readBuildId(): string {
  try {
    return (JSON.parse(readFileSync(join(staticDir, 'build.json'), 'utf8')) as { buildId: string }).buildId;
  } catch {
    return 'dev';
  }
}

const connectUrl = connectUrlFor(config);
let running;
try {
  running = await startServer({
    port: config.port,
    host: config.host,
    dataDir: resolve(config.dataDir),
    seed: config.demo ? makeSampleBoard : makeEmptyBoard,
    reset: config.demo,
    staticDir: hasApp ? staticDir : null,
    connectUrl,
    buildId: readBuildId(),
    log: message => console.log(message),
  });
} catch (error) {
  const code = (error as NodeJS.ErrnoException).code;
  console.error(
    code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Is the board already running? (Or set PORT to another number.)`
      : `Could not start the server: ${String(error)}`,
  );
  process.exit(1);
}

const local = `http://localhost:${running.port}`;
console.log(`\nDigital Sticky is running${config.demo ? ' with the sample board (demo mode: it resets on every start)' : ''}.`);
console.log(`  Board saved in:   ${resolve(config.dataDir)}`);
if (!hasApp) console.log('  The web app is not built yet: run `npm run build` first.');
console.log(`  Wall screen:      ${local}/#wall`);
console.log(`  On this computer: ${local}`);
if (connectUrl) console.log(`  On your phone:    ${connectUrl}  (same Wi-Fi)`);
console.log('');

const server = running;
let stopping = false;
function stop(reason: string, code = 0): void {
  if (stopping) return;
  stopping = true;
  console.log(`\n${reason}: saving the board and stopping.`);
  try {
    server.stopNow();
  } catch (error) {
    console.error('Could not save the board:', error);
    code = 1;
  }
  process.exit(code);
}

process.on('SIGINT', () => stop('Ctrl+C'));
process.on('SIGTERM', () => stop('Stop requested'));
process.on('uncaughtException', error => {
  console.error(error);
  stop('Unexpected error', 1);
});
