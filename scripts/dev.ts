// `npm run dev`: the board server (restarts when server/ or shared/ code changes) and
// the Vite dev server (hot reload for the web app), which passes /api to the board server.
import { spawn, type ChildProcess } from 'node:child_process';

const demo = process.argv.includes('--demo');
const children: ChildProcess[] = [
  spawn(process.execPath, ['--watch', 'server/index.ts', ...(demo ? ['--demo'] : [])], {
    stdio: 'inherit',
    env: { ...process.env, PORT: '3000' },
  }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit' }),
];

let stopping = false;
function stopAll(code: number): void {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  process.exitCode = code;
}

for (const child of children) child.on('exit', code => stopAll(code ?? 0));
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
