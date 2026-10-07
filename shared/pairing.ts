// Sign-in codes: the wall shows one (in its QR code and as text), and a phone signs in
// by scanning it or typing it. They're 8 characters in Crockford's base 32, which leaves
// out letters that look like others (I, L, O, U), and are shown as "K7QM-2XPA".

export const PAIR_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const PAIR_CODE_LENGTH = 8;
/** The app's address for signing in with a code: `#pair-K7QM2XPA`. */
export const PAIR_ROUTE_PREFIX = 'pair-';

/** What was typed or scanned, as the code itself: "k7qm 2xpa" and "K7QM-2XPA" both work, and O, I and L read as 0, 1, 1. */
export function normalizePairCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}

/** "K7QM-2XPA", for reading off a screen. */
export function formatPairCode(code: string): string {
  return code.length === PAIR_CODE_LENGTH ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** The address a new device opens to sign in with `code` (`base` is the board's address). */
export function pairUrl(base: string, code: string): string {
  return `${base.replace(/\/+$/, '')}/#${PAIR_ROUTE_PREFIX}${code}`;
}
