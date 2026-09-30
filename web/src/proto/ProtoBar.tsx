import { useState } from 'react';
import { ChevronDown, FlaskConical } from 'lucide-react';
import { navigate } from '../lib/route.ts';
import { board, useBoard } from '../store/board.ts';
import { applyPreset } from './presets.ts';
import { proto, useProto } from './protoState.ts';

const VIEWS = [
  { token: 'demo', label: 'Side by side' },
  { token: 'wall', label: 'Wall' },
  { token: 'board', label: 'Phone / computer' },
  { token: 'login', label: 'PIN screen' },
];

/** Floating panel for trying the prototype's screens and states. Not part of the real app. */
export function ProtoBar({ current }: { current: string }) {
  const [open, setOpen] = useState(false);
  const data = useBoard();
  const { titleFont } = useProto();
  const { mode, style } = data.settings.night;
  const nightState = mode === 'off' ? 'day' : mode === 'on' ? style : 'auto';

  return (
    <div className={`proto${open ? ' is-open' : ''}`}>
      <button type="button" className="proto-toggle" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <FlaskConical aria-hidden="true" />
        <span>Prototype</span>
        <ChevronDown aria-hidden="true" className="proto-chevron" />
      </button>
      {open && (
        <div className="proto-panel">
          <p className="proto-note">Sample data. Nothing is saved; reload to reset.</p>
          <div className="proto-group">
            <span className="proto-label">Screen</span>
            <div className="proto-options">
              {VIEWS.map(v => (
                <button key={v.token} type="button" className={current === v.token ? 'is-on' : ''} onClick={() => navigate(v.token)}>
                  {v.label}
                </button>
              ))}
            </div>
          </div>
          <div className="proto-group">
            <span className="proto-label">Wall look</span>
            <div className="proto-options">
              <button type="button" className={nightState === 'day' ? 'is-on' : ''} onClick={() => applyPreset('day')}>
                Day
              </button>
              <button type="button" className={nightState === 'dim' ? 'is-on' : ''} onClick={() => applyPreset('dim')}>
                Night: dim
              </button>
              <button type="button" className={nightState === 'clock' ? 'is-on' : ''} onClick={() => applyPreset('clock')}>
                Night: clock
              </button>
            </div>
          </div>
          <div className="proto-group">
            <span className="proto-label">Try</span>
            <div className="proto-options">
              <button type="button" className={data.alerts.length ? 'is-on' : ''} onClick={() => (data.alerts.length ? data.alerts.forEach(a => board.dismissAlert(a.id)) : applyPreset('banner'))}>
                Reminder pop-up
              </button>
              <button type="button" className={data.settings.wall.showConnect ? 'is-on' : ''} onClick={() => board.updateSettings(s => ({ ...s, wall: { ...s.wall, showConnect: !s.wall.showConnect } }))}>
                Phone QR code
              </button>
            </div>
          </div>
          <div className="proto-group">
            <span className="proto-label">Note writing</span>
            <div className="proto-options">
              <button type="button" className={titleFont === 'marker' ? 'is-on' : ''} onClick={() => proto.set({ titleFont: 'marker' })}>
                Marker
              </button>
              <button type="button" className={titleFont === 'clean' ? 'is-on' : ''} onClick={() => proto.set({ titleFont: 'clean' })}>
                Clean
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
