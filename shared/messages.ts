import type { Channel, Note } from './types.ts';

// A to-do can be a message: an email, a text or a call. Once it's sent, the board can
// nudge you to follow up until you hear back.

export interface ChannelInfo {
  label: string;
  /** The small print at the top of a square, before and after sending. */
  toSend: string;
  sent: string;
  markSent: string;
  /** "Sent Oct 6", "Called Oct 6". */
  sentWord: string;
  to: string;
  toPlaceholder: string;
  titlePlaceholder: string;
}

export const CHANNEL_INFO: Record<Channel, ChannelInfo> = {
  email: {
    label: 'Email',
    toSend: 'Email · to send',
    sent: 'Email · sent',
    markSent: 'Mark sent',
    sentWord: 'Sent',
    to: 'To',
    toPlaceholder: 'Name or email address',
    titlePlaceholder: 'What is the email about?',
  },
  text: {
    label: 'Text',
    toSend: 'Text · to send',
    sent: 'Text · sent',
    markSent: 'Mark sent',
    sentWord: 'Sent',
    to: 'To',
    toPlaceholder: 'Name or number',
    titlePlaceholder: 'What is the text about?',
  },
  call: {
    label: 'Call',
    toSend: 'Call',
    sent: 'Called',
    markSent: 'Mark called',
    sentWord: 'Called',
    to: 'Who',
    toPlaceholder: 'Name or number',
    titlePlaceholder: 'Who do you need to call, and why?',
  },
};

/** "EMAIL · TO SEND", "TEXT · SENT", "CALLED" at the top of a square. */
export function messageKicker(note: Pick<Note, 'channel' | 'sentAt'>): string | undefined {
  if (!note.channel) return undefined;
  const info = CHANNEL_INFO[note.channel];
  return note.sentAt ? info.sent : info.toSend;
}
