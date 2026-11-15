import { execFile } from 'node:child_process';
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// scripts/linux/domain.sh, run on a copy of the app folder with stand-ins for cloudflared,
// sudo, apt-get, systemctl, loginctl and curl. Nothing is installed and nothing goes online.

const REPO = resolve('.');
const ID = '6ff42ae2-765d-4adf-8112-31c55c1551ef';

let dir: string;
let app: string;
let bin: string;
let home: string;

// Plays cloudflared: signing in (for the domain in $STUB_ZONE), making the tunnel, and the DNS record.
const CLOUDFLARED = `#!/bin/bash
echo "cloudflared $*" >> "$STUB_DIR/calls"
case "$1 $2" in
  "--version "*) echo "cloudflared version 2025.8.0 (built 2025-08-01)" ;;
  "tunnel login")
    printf 'Please open the following URL and log in with your Cloudflare account:\\n\\nhttps://dash.cloudflare.com/argotunnel?aud=&callback=https%%3A%%2F%%2Flogin.cloudflareaccess.org%%2Fabc\\n\\n'
    mkdir -p "$HOME/.cloudflared"; echo cert > "$HOME/.cloudflared/cert.pem"
    echo "You have successfully logged in." ;;
  "tunnel list")
    if [ -f "$STUB_DIR/tunnel" ]; then echo '[{"id":"${ID}","name":"sticky-wall","connections":[]}]'; else echo '[]'; fi ;;
  "tunnel create")
    touch "$STUB_DIR/tunnel"; echo '{}' > "$HOME/.cloudflared/${ID}.json"
    echo "Created tunnel sticky-wall with id ${ID}" ;;
  "tunnel route")
    host=$5; zone=\${STUB_ZONE:-example.com}
    if [ -f "$STUB_DIR/record-taken" ]; then echo "Failed to add route: code: 1003, reason: An A, AAAA, or CNAME record with that host already exists." >&2; exit 1; fi
    [[ $host == *.$zone ]] || host=$host.$zone
    echo "2025-08-01T10:00:00Z INF Added CNAME $host which will route to this tunnel tunnelID=${ID}" >&2 ;;
esac
`;

const PASS = (name: string) => `#!/bin/bash
echo "${name} $*" >> "$STUB_DIR/calls"
`;

const SUDO = `#!/bin/bash
echo "sudo $*" >> "$STUB_DIR/calls"
case "$1" in
  apt-get) [ "$2" = install ] && { cp "$STUB_DIR/cloudflared.stub" "$STUB_DIR/bin/cloudflared"; chmod +x "$STUB_DIR/bin/cloudflared"; } ;;
  tee) cat > /dev/null ;;
esac
exit 0
`;

const CURL = `#!/bin/bash
echo "curl $*" >> "$STUB_DIR/calls"
out=''
while [ $# -gt 0 ]; do
  [ "$1" = -o ] && { out=$2; shift; }
  shift
done
echo key > "$out"
`;

const LOGINCTL = `#!/bin/bash
echo "\${STUB_LINGER:-yes}"
`;

async function script(name: string, text: string): Promise<void> {
  await writeFile(join(bin, name), text);
  await chmod(join(bin, name), 0o755);
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sticky-domain-'));
  app = join(dir, 'app');
  bin = join(dir, 'bin');
  home = join(dir, 'home');
  await mkdir(join(app, 'scripts', 'linux'), { recursive: true });
  await mkdir(bin);
  await mkdir(home);
  for (const file of ['scripts/linux/domain.sh', 'scripts/linux/common.sh', 'scripts/envFile.ts', 'scripts/qr.ts']) {
    await copyFile(join(REPO, file), join(app, file));
  }
  await symlink(join(REPO, 'node_modules'), join(app, 'node_modules'));
  // A port nothing listens on, so the script doesn't find a board running.
  await writeFile(join(app, '.env'), 'PORT=45123\n');
  await writeFile(join(dir, 'cloudflared.stub'), CLOUDFLARED);
  await script('cloudflared', CLOUDFLARED);
  await script('sudo', SUDO);
  await script('systemctl', PASS('systemctl'));
  await script('curl', CURL);
  await script('loginctl', LOGINCTL);
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
      [join(app, 'scripts/linux/domain.sh'), ...args],
      { env: { HOME: home, USER: 'souren', PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`, STUB_DIR: dir, ...env }, timeout: 30_000 },
      (error, out, err) => done({ code: error ? ((error as { code?: number }).code ?? 1) : 0, out, err }),
    );
  });
}

const calls = async () => (await readFile(join(dir, 'calls'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
const env = () => readFile(join(app, '.env'), 'utf8');

describe('domain.sh', () => {
  it('signs in to Cloudflare, makes the tunnel and its DNS record, runs it, and saves the address', async () => {
    const result = await run(['https://Sticky.Example.com/', '--no-restart']);
    expect(result.err).toBe('');
    expect(result.code).toBe(0);
    expect(await calls()).toEqual(
      expect.arrayContaining([
        'cloudflared tunnel login',
        'cloudflared tunnel create sticky-wall',
        'cloudflared tunnel route dns sticky-wall sticky.example.com',
        'systemctl --user enable sticky-wall-tunnel.service',
        'systemctl --user restart sticky-wall-tunnel.service',
      ]),
    );
    // The sign-in link shows as a QR code too, for scanning with a phone.
    const link = result.out.indexOf('https://dash.cloudflare.com/argotunnel');
    expect(link).toBeGreaterThan(-1);
    expect(result.out.slice(link)).toMatch(/[▀▄█]{10}/);

    const config = await readFile(join(home, '.cloudflared/sticky-wall.yml'), 'utf8');
    expect(config).toContain(`tunnel: ${ID}`);
    expect(config).toContain(`credentials-file: ${home}/.cloudflared/${ID}.json`);
    expect(config).toContain('  - hostname: sticky.example.com\n    service: http://127.0.0.1:45124\n  - service: http_status:404');
    const service = await readFile(join(home, '.config/systemd/user/sticky-wall-tunnel.service'), 'utf8');
    expect(service).toContain(`ExecStart="${bin}/cloudflared" --no-autoupdate tunnel --config "${home}/.cloudflared/sticky-wall.yml" run`);
    expect(await env()).toBe('PORT=45123\nPUBLIC_URL=https://sticky.example.com\n');
    expect(await calls()).not.toContain('systemctl --user restart sticky-wall.service');
  });

  it('doesn’t sign in or make the tunnel again when that’s done', async () => {
    await run(['sticky.example.com', '--no-restart']);
    await writeFile(join(dir, 'calls'), '');
    const again = await run(['sticky.example.com', '--no-restart']);
    expect(again.code).toBe(0);
    expect(await calls()).not.toContain('cloudflared tunnel login');
    expect(await calls()).not.toContain('cloudflared tunnel create sticky-wall');
    expect((await env()).match(/PUBLIC_URL=/g)).toHaveLength(1);
  });

  it('installs cloudflared from Cloudflare’s package site when it’s missing', async () => {
    await rm(join(bin, 'cloudflared'));
    const result = await run(['sticky.example.com', '--yes', '--no-restart']);
    expect(result.code).toBe(0);
    const log = await calls();
    expect(log.find(line => line.startsWith('curl'))).toMatch(/https:\/\/pkg\.cloudflare\.com\/cloudflare-main\.gpg$/);
    expect(log).toContain('sudo apt-get install -y -qq cloudflared');
    expect(await env()).toContain('PUBLIC_URL=https://sticky.example.com');
  });

  it('stops when the name is taken, or signed in for another domain', async () => {
    await writeFile(join(dir, 'record-taken'), '');
    const taken = await run(['sticky.example.com', '--no-restart']);
    expect(taken.code).toBe(1);
    expect(taken.err).toContain('sticky.example.com already has a DNS record');
    await rm(join(dir, 'record-taken'));

    const wrong = await run(['sticky.example.com', '--no-restart'], { STUB_ZONE: 'other.org' });
    expect(wrong.code).toBe(1);
    expect(wrong.err).toContain('Cloudflare made sticky.example.com.other.org instead');
    expect(await env()).toBe('PORT=45123\n');
  });

  it('refuses names that aren’t one, Tailscale names, and a board without an internet door', async () => {
    expect((await run(['--no-restart'])).err).toContain('Say which address to use');
    expect((await run(['not a name', '--no-restart'])).err).toContain('isn\'t a name like');
    expect((await run(['nuc.tail1234.ts.net', '--no-restart'])).err).toContain('use scripts/linux/anywhere.sh');
    await writeFile(join(app, '.env'), 'PUBLIC_PORT=off\n');
    expect((await run(['sticky.example.com', '--no-restart'])).err).toContain('PUBLIC_PORT is off');
  });

  it('says what’s on with --status, and turns it off with --off', async () => {
    expect((await run(['--status'])).out).toContain('Off. Turn it on with');
    await run(['sticky.example.com', '--no-restart']);
    expect((await run(['--status'])).out).toContain("The board's address: https://sticky.example.com");

    const off = await run(['--off', '--no-restart']);
    expect(off.code).toBe(0);
    expect(await calls()).toContain('systemctl --user disable --now sticky-wall-tunnel.service');
    await expect(access(join(home, '.config/systemd/user/sticky-wall-tunnel.service'))).rejects.toThrow();
    expect(await env()).toBe('PORT=45123\n');
    expect(off.out).toContain('cloudflared tunnel delete sticky-wall');
  });

  it('says when it won’t start until someone logs in', async () => {
    const result = await run(['sticky.example.com', '--no-restart'], { STUB_LINGER: 'no' });
    expect(result.code).toBe(0);
    expect(result.err).toContain('sudo loginctl enable-linger souren');
  });
});
