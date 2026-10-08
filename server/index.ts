import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { makeEmptyBoard } from '../shared/defaults.ts';
import { makeSampleBoard } from '../shared/sample.ts';
import { connectUrlFor, homeUrlFor, readConfig, type Config } from './config.ts';
import { startServer } from './server.ts';

// Starts the board server: `npm start` (or `npm run demo` for the sample board).

try {
  process.loadEnvFile();
} catch {
  // No .env file: defaults and real environment variables are used.
}

let config: Config;
try {
  config = readConfig(process.env, process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
const staticDir = resolve('dist/web');
const hasApp = existsSync(join(staticDir, 'index.html'));

function readBuildId(): string {
  try {
    return (JSON.parse(readFileSync(join(staticDir, 'build.json'), 'utf8')) as { buildId: string }).buildId;
  } catch {
    return 'dev';
  }
}

// The wall screen's script, for its "Exit to desktop" button.
const kioskScript = resolve('scripts/linux/kiosk.sh');

// For the message below; screens get it fresh each time (at boot the network may not have an address yet).
const connectUrl = connectUrlFor(config);
// The board can be used from anywhere when it has an https address leading to its internet door.
const anywhereUrl = config.publicPort !== null && config.publicUrl?.startsWith('https://') ? config.publicUrl : null;
let running;
try {
  running = await startServer({
    port: config.port,
    host: config.host,
    dataDir: resolve(config.dataDir),
    seed: config.demo ? makeSampleBoard : makeEmptyBoard,
    reset: config.demo,
    staticDir: hasApp ? staticDir : null,
    connectUrl: () => connectUrlFor(config),
    homeUrl: () => homeUrlFor(config),
    buildId: readBuildId(),
    log: message => console.log(message),
    pin: config.pin,
    trustLocalhost: config.trustLocalhost,
    publicPort: config.publicPort,
    anywhereUrl,
    outsideHttps: !config.publicUrl?.startsWith('http://'),
    allowedHosts: config.allowedHosts,
    remoteDebugPort: config.kioskDebugPort,
    kioskScript: process.platform === 'linux' && existsSync(kioskScript) ? kioskScript : null,
  });
} catch (error) {
  const { code, port } = error as NodeJS.ErrnoException & { port?: number };
  console.error(
    code === 'EADDRINUSE'
      ? port === config.publicPort
        ? `Port ${port} (for using the board from anywhere) is already in use. Set PUBLIC_PORT to another number, or to "off".`
        : `Port ${config.port} is already in use. Is the board already running? (Or set PORT to another number.)`
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
if (anywhereUrl) console.log(`  From anywhere:    ${anywhereUrl}  (devices sign in by scanning the code on the wall)`);
else if (connectUrl) console.log(`  On your phone:    ${connectUrl}  (same Wi-Fi)`);
console.log(
  config.pin
    ? `  PIN:              on${config.trustLocalhost ? ' (this computer opens the wall without it)' : ''}`
    : `  PIN:              off. Anyone on your Wi-Fi can open the board${anywhereUrl ? ' (from the internet, devices still sign in)' : ''}; run \`npm run pin\` to set one.`,
);
if (!anywhereUrl && process.platform === 'linux') console.log('  From anywhere:    off. Run scripts/linux/anywhere.sh to turn it on.');
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
