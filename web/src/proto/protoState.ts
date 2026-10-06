// Prototype-only switches (not part of the real app).

/** `?proto=0` hides the prototype bar (screenshots). */
export const SHOW_PROTO_BAR = (() => {
  try {
    return new URLSearchParams(window.location.search).get('proto') !== '0';
  } catch {
    return true;
  }
})();
