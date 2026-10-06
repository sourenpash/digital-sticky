import { ListTodo, Mail, MessageSquareText, Phone, Send, Undo2, type LucideIcon } from 'lucide-react';
import { CHANNEL_INFO } from '../../../shared/messages.ts';
import { CHANNELS, type Channel, type Note } from '../../../shared/types.ts';
import { sentLabel } from './FollowUpField.tsx';

export const CHANNEL_ICON: Record<Channel, LucideIcon> = { email: Mail, text: MessageSquareText, call: Phone };

interface Props {
  note: Note;
  now: Date;
  /** In the new-sticky form, where "Add to board" is the main button. */
  quiet?: boolean;
  onChange: (patch: Partial<Note>) => void;
  /** Marked sent: ask about following up. */
  onSent: () => void;
}

/** A to-do can be an email, text or call to make; once it's sent, a follow-up can be set. */
export function MessageField({ note, now, quiet, onChange, onSent }: Props) {
  const info = note.channel ? CHANNEL_INFO[note.channel] : null;
  const pick = (channel: Channel | undefined) => {
    if (channel === note.channel) return;
    // A plain to-do has nobody to send to and nothing to follow up on.
    onChange(channel ? { channel } : { channel: undefined, sentAt: undefined, followUp: undefined, funder: undefined });
  };

  return (
    <fieldset className="ne-section">
      <legend className="ne-label">
        {note.channel ? (() => {
          const Icon = CHANNEL_ICON[note.channel];
          return <Icon aria-hidden="true" />;
        })() : <ListTodo aria-hidden="true" />}{' '}
        Type
      </legend>
      <div className="seg-group" role="radiogroup" aria-label="What kind of to-do">
        <button type="button" role="radio" aria-checked={!note.channel} className={`seg${!note.channel ? ' is-on' : ''}`} onClick={() => pick(undefined)}>
          <ListTodo aria-hidden="true" /> To-do
        </button>
        {CHANNELS.map(channel => {
          const Icon = CHANNEL_ICON[channel];
          const on = note.channel === channel;
          return (
            <button key={channel} type="button" role="radio" aria-checked={on} className={`seg${on ? ' is-on' : ''}`} onClick={() => pick(channel)}>
              <Icon aria-hidden="true" /> {CHANNEL_INFO[channel].label}
            </button>
          );
        })}
      </div>
      {info && (
        <>
          <label className="field" htmlFor={`to-${note.id}`}>
            <span className="field-label">{info.to}</span>
            <input id={`to-${note.id}`} value={note.funder ?? ''} placeholder={info.toPlaceholder} onChange={e => onChange({ funder: e.target.value || undefined })} />
          </label>
          {note.sentAt ? (
            <div className="msg-sent">
              <span className="msg-sent-label">{sentLabel(note)}</span>
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => onChange({ sentAt: undefined, followUp: undefined })}>
                <Undo2 aria-hidden="true" /> Not yet
              </button>
            </div>
          ) : (
            <div className="msg-send">
              <button
                type="button"
                className={`btn btn-sm${quiet ? '' : ' btn-primary'}`}
                onClick={() => {
                  onChange({ sentAt: now.toISOString() });
                  onSent();
                }}
              >
                <Send aria-hidden="true" /> {info.markSent}
              </button>
              <span className="ne-hint">Then the board can remind you to follow up.</span>
            </div>
          )}
        </>
      )}
    </fieldset>
  );
}
