import { networkInterfaces } from 'node:os';

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  /** Demo mode: a separate folder, filled with the sample board on every start. */
  demo: boolean;
  /** Address to show on the wall for phones, e.g. a Tailscale https:// name. */
  publicUrl: string | null;
  /** 6–12 digits, or null for an open board. */
  pin: string | null;
  /** Let the wall computer's own browser (localhost) in without the PIN. */
  trustLocalhost: boolean;
  /** Extra names the board answers to. */
  allowedHosts: string[];
}

/** Settings come from environment variables (or a .env file) and a few flags. */
export function readConfig(env: NodeJS.ProcessEnv, argv: string[]): Config {
  const demo = argv.includes('--demo') || env.DEMO === '1';
  const port = Number(env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`PORT must be a port number, not "${env.PORT}"`);
  const pin = env.BOARD_PIN?.trim() || null;
  if (pin !== null && !/^\d{6,12}$/.test(pin)) {
    throw new Error('BOARD_PIN must be 6 to 12 digits. Run `npm run pin` to set it, or remove it from .env for an open board.');
  }
  const publicHost = env.PUBLIC_URL ? hostOf(env.PUBLIC_URL) : null;
  const allowedHosts = (env.ALLOWED_HOSTS ?? '')
    .split(',')
    .map(name => name.trim().toLowerCase())
    .filter(Boolean);
  return {
    port,
    host: env.HOST || '0.0.0.0',
    dataDir: env.DATA_DIR || (demo ? 'data-demo' : 'data'),
    demo,
    publicUrl: env.PUBLIC_URL ? env.PUBLIC_URL.replace(/\/+$/, '') : null,
    pin,
    trustLocalhost: !/^(0|false|no|off)$/i.test(env.TRUST_LOCALHOST ?? ''),
    allowedHosts: publicHost ? [...allowedHosts, publicHost] : allowedHosts,
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Virtual adapters (Docker, VMs, VPNs) have addresses a phone on the Wi-Fi can't reach.
const VIRTUAL = /^(lo|docker|br-|veth|virbr|vmnet|vboxnet|utun|tun|tap|tailscale|zt|wg)/i;
const PRIVATE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** This computer's address on the home network, e.g. 192.168.1.23. */
export function lanAddress(interfaces = networkInterfaces()): string | null {
  const candidates: string[] = [];
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) candidates.push(address.address);
    }
  }
  return candidates.find(address => PRIVATE.test(address)) ?? candidates[0] ?? null;
}

export function connectUrlFor(config: Config, interfaces = networkInterfaces()): string | null {
  if (config.publicUrl) return config.publicUrl;
  const address = lanAddress(interfaces);
  return address ? `http://${address}${config.port === 80 ? '' : `:${config.port}`}` : null;
}
