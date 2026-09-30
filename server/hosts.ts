import { isIP } from 'node:net';

// Which names this server answers to. A web page on some other site can make its own
// name point at the wall computer's address ("DNS rebinding") and then read and change
// the board through your browser; refusing unknown names stops that. Home-network names
// can't be registered by anyone on the internet, so those are always fine.

const HOME_SUFFIXES = ['.local', '.lan', '.home', '.internal', '.home.arpa', '.localdomain', '.localhost', '.ts.net'];

/** `hostname` as in `new URL(...).hostname`: lower case, IPv6 in brackets. */
export function hostAllowed(hostname: string, extra: readonly string[] = []): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '').replace(/^\[(.*)\]$/, '$1');
  if (!host) return false;
  if (isIP(host) || host === 'localhost') return true;
  if (!host.includes('.')) return true; // a single-label name like "nuc", from the home network
  if (HOME_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  return extra.includes(host);
}
