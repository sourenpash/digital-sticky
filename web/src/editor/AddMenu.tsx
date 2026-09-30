import { useEffect } from 'react';
import { Target, X } from 'lucide-react';
import type { LaneKind } from '../../../shared/types.ts';
import { TEMPLATES } from './templates.ts';

interface Props {
  onPick: (kind: LaneKind) => void;
  onGoal: () => void;
  onClose: () => void;
  desktop: boolean;
}

export function AddMenu({ onPick, onGoal, onClose, desktop }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className={`layer ${desktop ? 'layer-center' : 'layer-bottom'}`} role="dialog" aria-modal="true" aria-labelledby="add-title">
      <button type="button" className="scrim" aria-label="Close" onClick={onClose} />
      <div className="add-menu">
        <header className="add-head">
          <h2 id="add-title">Add to the wall</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            <X />
          </button>
        </header>
        <ul className="add-list">
          {TEMPLATES.map(({ kind, title, hint, icon: Icon, color }) => (
            <li key={kind}>
              <button type="button" className="add-item" onClick={() => onPick(kind)}>
                <span className={`add-icon paper-${color}`}>
                  <Icon aria-hidden="true" />
                </span>
                <span className="add-text">
                  <span className="add-title">{title}</span>
                  <span className="add-hint">{hint}</span>
                </span>
              </button>
            </li>
          ))}
          <li className="add-divider">
            <button type="button" className="add-item" onClick={onGoal}>
              <span className="add-icon add-icon-goal">
                <Target aria-hidden="true" />
              </span>
              <span className="add-text">
                <span className="add-title">Goal</span>
                <span className="add-hint">A target with a progress bar, like 5 applications by December</span>
              </span>
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}
