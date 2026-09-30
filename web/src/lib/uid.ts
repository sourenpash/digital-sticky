/** Random id. Uses getRandomValues, which (unlike randomUUID) works on plain-http LAN pages. */
export function uid(): string {
  const bytes = new Uint8Array(9);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 14);
}
