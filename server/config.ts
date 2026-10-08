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
  /** The wall browser's debugging port (for the phone remote), or null to turn the remote off. */
  kioskDebugPort: number | null;
  /**
   * A second port, on this computer only, for requests from the internet (Tailscale Funnel
   * forwards to it). Everything arriving there needs signing in. Null turns it off.
   */
  publicPort: number | null;
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
  const debug = (env.KIOSK_DEBUG_PORT ?? '').trim();
  const kioskDebugPort = /^(0|off|false|no)$/i.test(debug) ? null : Number(debug || 9222);
  if (kioskDebugPort !== null && (!Number.isInteger(kioskDebugPort) || kioskDebugPort < 1 || kioskDebugPort > 65_535 || kioskDebugPort === port)) {
    throw new Error(`KIOSK_DEBUG_PORT must be a port number other than PORT, or "off", not "${env.KIOSK_DEBUG_PORT}"`);
  }
  const outside = (env.PUBLIC_PORT ?? '').trim();
  const publicPort = /^(0|off|false|no)$/i.test(outside) ? null : Number(outside || port + 1);
  if (
    publicPort !== null &&
    (!Number.isInteger(publicPort) || publicPort < 1 || publicPort > 65_535 || publicPort === port || publicPort === kioskDebugPort)
  ) {
    throw new Error(`PUBLIC_PORT must be a port number other than PORT and KIOSK_DEBUG_PORT, or "off", not "${env.PUBLIC_PORT}"`);
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
    kioskDebugPort,
    publicPort,
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
  return config.publicUrl ?? homeUrlFor(config, interfaces);
}

/** The board's address on the home network (by this computer's address there), or null when it has none. */
export function homeUrlFor(config: Config, interfaces = networkInterfaces()): string | null {
  const address = lanAddress(interfaces);
  return address ? `http://${address}${config.port === 80 ? '' : `:${config.port}`}` : null;
}
