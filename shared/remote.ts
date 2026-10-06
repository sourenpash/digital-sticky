// The phone remote for the wall screen: what the phone sends (api/remote) and what
// the board server answers. The server carries the commands out in the wall
// computer's browser.

export const REMOTE_KEYS = ['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'] as const;
export type RemoteKey = (typeof REMOTE_KEYS)[number];

/** The id of the cursor the remote draws on the wall's page (the wall tells its moves from a real mouse's by it). */
export const REMOTE_CURSOR_ID = '__sticky_wall_cursor__';

/** Moves are in pixels of a 1920-pixel-wide wall; the server scales them to the real screen. */
export const REMOTE_WALL_WIDTH = 1920;
/** Most commands in one request. */
export const MAX_REMOTE_COMMANDS = 100;
/** Longest text typed in one command. */
export const MAX_REMOTE_TEXT = 2000;
/** Largest single move or scroll step. */
export const MAX_REMOTE_STEP = 5000;

export type RemoteCommand =
  | { type: 'move'; dx: number; dy: number }
  | { type: 'click' }
  /** Wheel steps: positive scrolls down (dy) or right (dx). */
  | { type: 'scroll'; dx: number; dy: number }
  | { type: 'text'; text: string }
  | { type: 'key'; key: RemoteKey }
  | { type: 'back' }
  | { type: 'reload' }
  /** Back to the wall screen, closing any other tabs. */
  | { type: 'board' }
  /** A website, in a new tab over the wall (Back or Board closes it). */
  | { type: 'open'; url: string }
  /** Answers a website's "OK / Cancel" question showing on the wall. */
  | { type: 'dialog'; accept: boolean };

/** The kind of text box selected on the wall, so the phone can offer the right keyboard. */
export const REMOTE_FIELDS = ['text', 'password', 'email', 'url', 'number', 'tel', 'search'] as const;
export type RemoteField = (typeof REMOTE_FIELDS)[number];

/** Why the remote can't reach the wall: turned off, or the wall's browser isn't running with remote control. */
export type RemoteUnavailableReason = 'off' | 'no-browser';

export type RemoteStatus =
  | {
      available: true;
      /** The text box selected on the wall (typing goes into it), or null. */
      field: RemoteField | null;
      /** A question from the website on the wall, waiting for OK or Cancel. */
      dialog: { message: string } | null;
      /** The wall shows the board (not another website). */
      onBoard: boolean;
      title: string;
      url: string;
    }
  | { available: false; reason: RemoteUnavailableReason };

/** POST api/remote */
export interface RemoteRequest {
  commands: RemoteCommand[];
}
