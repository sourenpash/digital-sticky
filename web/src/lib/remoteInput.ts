import { MAX_REMOTE_TEXT, type RemoteCommand } from '../../../shared/remote.ts';

// The phone remote's input handling, kept free of the app so it can be tested on its own.

/**
 * Adds a command to the ones waiting to be sent. Moves and scrolls add up while a
 * request is on its way, and typing joins up, so a slow network sends fewer, bigger steps.
 */
export function queueCommand(queue: RemoteCommand[], command: RemoteCommand): void {
  const last = queue.at(-1);
  if (last?.type === 'move' && command.type === 'move') {
    last.dx += command.dx;
    last.dy += command.dy;
  } else if (last?.type === 'scroll' && command.type === 'scroll') {
    last.dx += command.dx;
    last.dy += command.dy;
  } else if (last?.type === 'text' && command.type === 'text' && last.text.length + command.text.length <= MAX_REMOTE_TEXT) {
    last.text += command.text;
  } else {
    queue.push({ ...command });
  }
}

/** Split into characters people see as one (so an emoji is one Backspace, not two). */
function graphemes(text: string): string[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text), part => part.segment);
  }
  return Array.from(text);
}

/**
 * What to send when the phone's typing field changes from `before` to `after`: Backspaces
 * for what was removed from the end, then the new text. Works for autocorrect, predictive
 * text, dictation and pasting, which all replace text rather than type it.
 */
export function typingChange(before: string, after: string): { backspaces: number; text: string } {
  const a = graphemes(before);
  const b = graphemes(after);
  let same = 0;
  while (same < a.length && same < b.length && a[same] === b[same]) same++;
  return { backspaces: a.length - same, text: b.slice(same).join('') };
}

/** A typed web address: https:// unless it's on the home network (an IP address, localhost, a .local name). */
export function websiteUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const home = /^(localhost|\d{1,3}(\.\d{1,3}){3}|\[[0-9a-f:]+\]|[a-z0-9-]+|[a-z0-9.-]+\.local)(:\d+)?(\/|$)/i.test(value);
  const full = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `${home ? 'http' : 'https'}://${value}`;
  try {
    const url = new URL(full);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}
