import { useEffect, useState, type ReactNode } from 'react';
import { CalendarDays, LayoutGrid, Monitor, Plus, SearchCheck } from 'lucide-react';
import { unverifiedCount } from '../../../shared/board.ts';
import type { LaneKind, Note } from '../../../shared/types.ts';
import { useNow } from '../lib/now.ts';
import type { EditorTab } from '../lib/route.ts';
import { board, draftNote, useBoard } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';
import { AddMenu } from './AddMenu.tsx';
import { BoardTab } from './BoardTab.tsx';
import { CalendarTab } from './CalendarTab.tsx';
import { CheckTab } from './CheckTab.tsx';
import { DisplayTab } from './DisplayTab.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { Toasts } from './Toasts.tsx';
import { useWidth } from './useWidth.ts';

export interface EditorRoute {
  tab: EditorTab;
  noteId?: string;
  newKind?: LaneKind;
}

const TABS: Array<{ tab: EditorTab; label: string; icon: typeof LayoutGrid }> = [
  { tab: 'board', label: 'Board', icon: LayoutGrid },
  { tab: 'calendar', label: 'Calendar', icon: CalendarDays },
  { tab: 'check', label: 'To check', icon: SearchCheck },
  { tab: 'display', label: 'Wall', icon: Monitor },
];

function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" aria-hidden="true" />
      <span className="brand-name">Digital Sticky</span>
    </div>
  );
}

function LiveBadge() {
  return (
    <span className="live" title="Changes show on the wall instantly">
      <span className="live-dot" aria-hidden="true" /> Live
    </span>
  );
}

/** The editing app for phones and computers. Below 760px wide it uses the phone layout. */
export function EditorApp({ route, go }: { route: EditorRoute; go: (token: string) => void }) {
  const data = useBoard();
  const now = useNow();
  const { ref, width } = useWidth<HTMLDivElement>();
  const desktop = width >= 760;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [lastTab, setLastTab] = useState<EditorTab>(route.tab);

  const sheetOpen = Boolean(route.noteId || route.newKind);
  const tab = sheetOpen ? lastTab : route.tab;

  useEffect(() => {
    if (!route.noteId && !route.newKind) setLastTab(route.tab);
  }, [route.tab, route.noteId, route.newKind]);

  useEffect(() => {
    setDraft(route.newKind ? draftNote(route.newKind, board.get().lanes) : null);
  }, [route.newKind]);

  const selected = route.noteId ? data.notes.find(n => n.id === route.noteId) : undefined;
  const close = () => go(lastTab);
  const openNote = (id: string) => go(`note-${id}`);

  useEffect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && go(lastTab);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sheetOpen, lastTab, go]);

  const addDraft = () => {
    if (!draft) return;
    board.addNote(draft);
    const lane = data.lanes.find(l => l.id === draft.laneId);
    showToast({ text: `Added to ${lane?.title ?? 'the board'}. It's on the wall now.` });
    go(lastTab);
  };

  const deleteSelected = () => {
    if (!selected) return;
    const removed = board.deleteNote(selected.id);
    go(lastTab);
    if (removed) showToast({ text: `Deleted “${removed.title}”`, actionLabel: 'Undo', action: () => board.restoreNote(removed) });
  };

  const toggleDone = () => {
    if (!selected) return;
    const done = !selected.done;
    board.setDone(selected.id, done);
    if (done) {
      const id = selected.id;
      go(lastTab);
      showToast({ text: 'Marked done. It stays on the wall, faded, until midnight.', actionLabel: 'Undo', action: () => board.setDone(id, false) });
    }
  };

  const editor: ReactNode = draft ? (
    <NoteEditor
      key={draft.id}
      note={draft}
      lanes={data.lanes}
      mode="new"
      onChange={patch => setDraft(d => (d ? { ...d, ...patch } : d))}
      onClose={close}
      onAdd={addDraft}
    />
  ) : selected ? (
    <NoteEditor
      key={selected.id}
      note={selected}
      lanes={data.lanes}
      mode="edit"
      onChange={patch => board.updateNote(selected.id, patch)}
      onClose={close}
      onDelete={deleteSelected}
      onToggleDone={toggleDone}
    />
  ) : null;

  const toCheck = data.notes.filter(n => !n.done).reduce((sum, n) => sum + unverifiedCount(n), 0);
  const content = (() => {
    switch (tab) {
      case 'calendar':
        return <CalendarTab board={data} now={now} desktop={desktop} onOpen={openNote} />;
      case 'check':
        return <CheckTab board={data} now={now} onOpen={openNote} />;
      case 'display':
        return <DisplayTab board={data} now={now} desktop={desktop} go={go} />;
      default:
        return <BoardTab board={data} now={now} desktop={desktop} selectedId={route.noteId} onOpen={openNote} />;
    }
  })();

  const pickTemplate = (kind: LaneKind) => {
    setAdding(false);
    go(`new-${kind}`);
  };

  return (
    <div ref={ref} className={`editor ${desktop ? 'is-desktop' : 'is-phone'}`}>
      {width === 0 ? null : desktop ? (
        <>
          <aside className="ed-side">
            <Brand />
            <button type="button" className="btn btn-primary ed-new" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" /> New note
            </button>
            <nav className="ed-nav" aria-label="Sections">
              {TABS.map(({ tab: t, label, icon: Icon }) => (
                <button key={t} type="button" className={`ed-nav-item${tab === t ? ' is-on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
                  <Icon aria-hidden="true" />
                  <span>{t === 'display' ? 'Wall display' : label}</span>
                  {t === 'check' && toCheck > 0 && <span className="badge">{toCheck}</span>}
                </button>
              ))}
            </nav>
            <div className="ed-side-foot">
              <LiveBadge />
            </div>
          </aside>
          <main className="ed-main">{content}</main>
          {editor && <aside className="ed-panel" aria-label="Note details">{editor}</aside>}
        </>
      ) : (
        <>
          <header className="ed-top">
            <Brand />
            <LiveBadge />
          </header>
          <main className="ed-scroll">{content}</main>
          <nav className="ed-tabbar" aria-label="Sections">
            {TABS.slice(0, 2).map(({ tab: t, label, icon: Icon }) => (
              <button key={t} type="button" className={`ed-tab${tab === t ? ' is-on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
                <Icon aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
            <button type="button" className="ed-add" aria-label="Add a note" onClick={() => setAdding(true)}>
              <Plus />
            </button>
            {TABS.slice(2).map(({ tab: t, label, icon: Icon }) => (
              <button key={t} type="button" className={`ed-tab${tab === t ? ' is-on' : ''}`} aria-current={tab === t ? 'page' : undefined} onClick={() => go(t)}>
                <span className="ed-tab-icon">
                  <Icon aria-hidden="true" />
                  {t === 'check' && toCheck > 0 && <span className="badge badge-dot">{toCheck}</span>}
                </span>
                <span>{label}</span>
              </button>
            ))}
          </nav>
          {editor && (
            <div className="layer layer-sheet" role="dialog" aria-modal="true" aria-label="Note details">
              <div className="sheet">{editor}</div>
            </div>
          )}
        </>
      )}
      {adding && <AddMenu desktop={desktop} onPick={pickTemplate} onClose={() => setAdding(false)} />}
      <Toasts />
    </div>
  );
}
