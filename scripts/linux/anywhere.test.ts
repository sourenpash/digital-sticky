import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/linux/anywhere.sh, run on a copy of the app folder with stand-ins for
// tailscale, sudo, systemctl and curl. Nothing is installed and nothing goes online.

const REPO = resolve('.');

let dir: string;
let app: string;
let bin: string;
let home: string;

// Plays Tailscale: signing in, and allowing Funnel the first time it's turned on.
const TAILSCALE = `#!/bin/bash
echo "tailscale $*" >> "$STUB_DIR/calls"
case "$1" in
  version) echo "\${STUB_TS_VERSION:-1.80.2}"; echo "  tailscale commit: 0123abc" ;;
  status)
    if [ -f "$STUB_DIR/signed-in" ]; then
      echo '{"BackendState":"Running","Self":{"DNSName":"nuc.tail1234.ts.net."},"CurrentTailnet":{"Name":"soren@example.com"}}'
    else
      echo '{"BackendState":"NeedsLogin","Self":{"DNSName":""}}'
    fi ;;
  up)
    printf '\\nTo authenticate, visit:\\n\\n\\thttps://login.tailscale.com/a/1a2b3c4d\\n\\n'
    touch "$STUB_DIR/signed-in"
    echo "Success." ;;
  funnel)
    if [ "$2" = status ]; then
      [ -f "$STUB_DIR/funnel-on" ] && printf '# Funnel on:\\n#     - https://nuc.tail1234.ts.net\\n\\nhttps://nuc.tail1234.ts.net (Funnel on)\\n|-- / proxy http://127.0.0.1:%s\\n' "$(cat "$STUB_DIR/funnel-on")" || echo "No serve config"
      exit 0
    fi
    if [ "$2" = --https=443 ] && [ "$3" = off ]; then rm -f "$STUB_DIR/funnel-on"; exit 0; fi
    if [ ! -f "$STUB_DIR/funnel-allowed" ]; then
      printf '\\nFunnel is not enabled on your tailnet.\\nTo enable, visit:\\n\\n         https://login.tailscale.com/f/funnel?node=nX1Y2Z\\n\\n'
      touch "$STUB_DIR/funnel-allowed"
      echo "Success."
    fi
    printf 'Available on the internet:\\n\\nhttps://nuc.tail1234.ts.net/\\n|-- proxy http://127.0.0.1:%s\\n\\nFunnel started and running in the background.\\n' "$3"
    echo "$3" > "$STUB_DIR/funnel-on" ;;
esac
`;

const SUDO = `#!/bin/bash
echo "sudo $*" >> "$STUB_DIR/calls"
exec "$@"
`;

const SYSTEMCTL = `#!/bin/bash
echo "systemctl $*" >> "$STUB_DIR/calls"
`;

// "Downloads" Tailscale's install script: one that puts the stand-in tailscale in place.
const CURL = `#!/bin/bash
echo "curl $*" >> "$STUB_DIR/calls"
out=''
while [ $# -gt 0 ]; do
  [ "$1" = -o ] && { out=$2; shift; }
  shift
done
printf '#!/bin/sh\\ncp "$STUB_DIR/tailscale.stub" "$STUB_DIR/bin/tailscale"\\nchmod +x "$STUB_DIR/bin/tailscale"\\necho "Installation complete!"\\n' > "$out"
`;

async function script(name: string, text: string): Promise<void> {
  await writeFile(join(bin, name), text);
  await chmod(join(bin, name), 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-anywhere-'));
  app = join(dir, 'app');
  bin = join(dir, 'bin');
  home = join(dir, 'home');
  await mkdir(join(app, 'scripts', 'linux'), { recursive: true });
  await mkdir(bin);
  await mkdir(home);
  for (const file of ['scripts/linux/anywhere.sh', 'scripts/linux/common.sh', 'scripts/envFile.ts', 'scripts/qr.ts']) {
    await copyFile(join(REPO, file), join(app, file));
  }
  await symlink(join(REPO, 'node_modules'), join(app, 'node_modules'));
  // A port nothing listens on, so the script doesn't find a board running.
  await writeFile(join(app, '.env'), 'BOARD_PIN=482915\nPORT=45123\n');
  await writeFile(join(dir, 'tailscale.stub'), TAILSCALE);
  await script('tailscale', TAILSCALE);
  await script('sudo', SUDO);
  await script('systemctl', SYSTEMCTL);
  await script('curl', CURL);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

interface Run {
  code: number;
  out: string;
  err: string;
}

function run(args: string[], env: Record<string, string> = {}): Promise<Run> {
  return new Promise(done => {
    execFile(
      'bash',
      [join(app, 'scripts/linux/anywhere.sh'), ...args],
      { env: { HOME: home, PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, STUB_DIR: dir, ...env }, timeout: 30_000 },
      (error, out, err) => done({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err }),
    );
  });
}

const calls = async () => (await readFile(join(dir, 'calls'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
const env = () => readFile(join(app, '.env'), 'utf8');

describe('anywhere.sh', () => {
  it('signs in to Tailscale, opens the board’s internet door with Funnel, and saves the address', async () => {
    const result = await run(['--no-restart']);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(await calls()).toEqual(
      expect.arrayContaining(['sudo tailscale up --qr', 'tailscale up --qr', 'sudo tailscale funnel --bg 45124', 'tailscale funnel --bg 45124']),
    );
    // The link to allow Funnel shows as a QR code too, for scanning with a phone.
    const link = result.out.indexOf('https://login.tailscale.com/f/funnel?node=nX1Y2Z');
    expect(link).toBeGreaterThan(-1);
    expect(result.out.slice(link)).toMatch(/[▀▄█]{10}/);
    expect(result.out).toContain('Signed in as soren@example.com. This computer is nuc.tail1234.ts.net');
    expect(await env()).toBe('BOARD_PIN=482915\nPORT=45123\nPUBLIC_URL=https://nuc.tail1234.ts.net\n');
    expect((await stat(join(app, '.env'))).mode & 0o777).toBe(0o600);
    expect(await calls()).not.toContain('systemctl --user restart sticky-wall.service');
  });

  it('doesn’t sign in or ask about Funnel again when that’s done', async () => {
    await run(['--no-restart']);
    await writeFile(join(dir, 'calls'), '');
    const again = await run(['--no-restart']);
    expect(again.code).toBe(0);
    expect(await calls()).not.toContain('tailscale up --qr');
    expect(again.out).not.toContain('login.tailscale.com');
    expect((await env()).match(/PUBLIC_URL=/g)).toHaveLength(1);
  });

  it('restarts the board so it uses the address, or says how', async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Restart the board to use it');
    // No board is running here, so the address can't be checked.
    expect(result.err).toContain("The board isn't running yet");

    // With the service install.sh sets up, it restarts that.
    await mkdir(join(home, '.config/systemd/user'), { recursive: true });
    await writeFile(join(home, '.config/systemd/user/sticky-wall.service'), '[Unit]\n');
    const restart = await new Promise<string>(done =>
      execFile('bash', ['-c', 'source "$1"; restart_board', '_', join(app, 'scripts/linux/common.sh')], { env: { HOME: home, PATH: `${bin}:/usr/bin:/bin`, STUB_DIR: dir } }, (_, out) =>
        done(out),
      ),
    );
    expect(restart).toContain('The board restarted with the change');
    expect(await calls()).toContain('systemctl --user restart sticky-wall.service');
  });

  it('installs Tailscale with its own script when it’s missing', async () => {
    await rm(join(bin, 'tailscale'));
    const result = await run(['--yes', '--no-restart']);
    expect(result.code).toBe(0);
    expect((await calls()).find(line => line.startsWith('curl'))).toMatch(/^curl -fsSL --retry 3 -o \S+ https:\/\/tailscale\.com\/install\.sh$/);
    expect(result.out).toContain('Installation complete!');
    expect(await env()).toContain('PUBLIC_URL=https://nuc.tail1234.ts.net');
  });

  it('says what’s on with --status, and turns it off with --off', async () => {
    expect((await run(['--status'])).out).toContain('Off: Tailscale is installed but not signed in');
    await run(['--no-restart']);
    const status = await run(['--status']);
    expect(status.out).toContain('https://nuc.tail1234.ts.net (Funnel on)');
    expect(status.out).toContain("The board's address: https://nuc.tail1234.ts.net");

    const off = await run(['--off', '--no-restart']);
    expect(off.code).toBe(0);
    expect(await calls()).toContain('sudo tailscale funnel --https=443 off');
    expect(await env()).toBe('BOARD_PIN=482915\nPORT=45123\n');
    expect((await run(['--status'])).out).toContain('No serve config');
  });

  it('stops when the board has no internet door, or Tailscale is too old', async () => {
    await writeFile(join(app, '.env'), 'PUBLIC_PORT=off\n');
    const noDoor = await run(['--no-restart']);
    expect(noDoor.code).toBe(1);
    expect(noDoor.err).toContain('PUBLIC_PORT is off');

    await writeFile(join(app, '.env'), '');
    const old = await run(['--no-restart'], { STUB_TS_VERSION: '1.48.2' });
    expect(old.code).toBe(1);
    expect(old.err).toContain('Tailscale 1.48.2 is too old');
    expect(await calls()).not.toContain('tailscale up --qr');
  });
});
