import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, LayoutGrid, Monitor, Plus, SearchCheck } from 'lucide-react';
import { unverifiedCount } from '../../../shared/board.ts';
import { applyPatch } from '../../../shared/ops.ts';
import { repeatStatus } from '../../../shared/recurring.ts';
import { stageLabel } from '../../../shared/applications.ts';
import type { Board, Channel, ChecklistItem, Goal, LaneKind, Note, Stage } from '../../../shared/types.ts';
import { currentTime, useNow } from '../lib/now.ts';
import type { EditorTab } from '../lib/route.ts';
import { board, draftGoal, draftNote, laneChange, poppedUpHere, useBoard, useSync } from '../store/board.ts';
import { showToast } from '../store/toasts.ts';
import { ActiveReminders } from './ActiveReminders.tsx';
import { AddMenu } from './AddMenu.tsx';
import { BoardTab } from './BoardTab.tsx';
import { CalendarTab } from './CalendarTab.tsx';
import { CheckTab } from './CheckTab.tsx';
import { DisplayTab } from './DisplayTab.tsx';
import { GoalEditor } from './GoalEditor.tsx';
import { NoteEditor } from './NoteEditor.tsx';
import { PairPrompt } from './PairPrompt.tsx';
import { Toasts } from './Toasts.tsx';
import { useWidth } from './useWidth.ts';

export interface EditorRoute {
  tab: EditorTab;
  noteId?: string;
  newKind?: LaneKind;
  /** A new to-do that's an email (or text, or call). */
  newChannel?: Channel;
  goalId?: string;
  newGoal?: boolean;
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

/** Live when connected to the wall; says so when changes are waiting for the connection. */
function LiveBadge() {
  const { status, waiting } = useSync();
  // Brief drops (a phone waking up) reconnect within a second or two; don't flash "Offline".
  const [shownOffline, setShownOffline] = useState(false);
  useEffect(() => {
    if (status !== 'offline') {
      setShownOffline(false);
      return;
    }
    const id = window.setTimeout(() => setShownOffline(true), 2500);
    return () => window.clearTimeout(id);
  }, [status]);

  if (shownOffline) {
    return (
      <span className="live is-offline" role="status" title="Changes are kept on this device and sent when the connection is back">
        <span className="live-dot" aria-hidden="true" /> Offline{waiting > 0 ? ` · ${waiting} waiting` : ''}
      </span>
    );
  }
  if (status === 'live' || status === 'offline') {
    return (
      <span className="live" role="status" title="Changes show on the wall instantly">
        <span className="live-dot" aria-hidden="true" /> Live
      </span>
    );
  }
  return (
    <span className="live is-connecting" role="status">
      <span className="live-dot" aria-hidden="true" /> Connecting…
    </span>
  );
}

/** A toast when a reminder goes off while this screen is open (not for old ones, or ones tapped here). */
function useReminderToasts(alerts: Board['alerts'], loaded: boolean, now: Date): void {
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const first = seen.current === null;
    const known = seen.current ?? new Set<string>();
    for (const alert of alerts) {
      if (known.has(alert.id) || poppedUpHere(alert.id)) continue;
      const age = now.getTime() - Date.parse(alert.firedAt);
      if (!first || age < 2 * 60_000) {
        const label = alert.kind === 'follow' ? 'Time to follow up' : 'Reminder';
        showToast({ text: `${label}: ${alert.title}`, actionLabel: 'Dismiss', action: () => board.dismissAlert(alert.id) }, 12_000);
      }
    }
    seen.current = new Set(alerts.map(alert => alert.id));
  }, [alerts, loaded, now]);
}

/** The editing app for phones and computers. Below 760px wide it uses the phone layout. */
export function EditorApp({ route, go }: { route: EditorRoute; go: (token: string) => void }) {
  const data = useBoard();
  const now = useNow();
  const { status } = useSync();
  useReminderToasts(data.alerts, status !== 'loading' && status !== 'locked', now);
  const { ref, width } = useWidth<HTMLDivElement>();
  const desktop = width >= 760;
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Note | null>(null);
  const [goalDraft, setGoalDraft] = useState<Goal | null>(null);
  const [lastTab, setLastTab] = useState<EditorTab>(route.tab);

  const sheetOpen = Boolean(route.noteId || route.newKind || route.goalId || route.newGoal);
  const tab = sheetOpen ? lastTab : route.tab;

  useEffect(() => {
    if (!sheetOpen) setLastTab(route.tab);
  }, [route.tab, sheetOpen]);

  useEffect(() => {
    setDraft(route.newKind ? draftNote(route.newKind, board.get().lanes, route.newChannel) : null);
  }, [route.newKind, route.newChannel]);

  useEffect(() => {
    setGoalDraft(route.newGoal ? draftGoal() : null);
  }, [route.newGoal]);

  const selected = route.noteId ? data.notes.find(n => n.id === route.noteId) : undefined;
  const selectedGoal = route.goalId ? data.goals.find(g => g.id === route.goalId) : undefined;

  // Deleted on another device (or an old link): close it instead of showing an empty panel.
  const missing = (route.noteId && !selected) || (route.goalId && !selectedGoal);
  useEffect(() => {
    if (!missing) return;
    go(lastTab);
    showToast({ text: route.goalId ? 'That goal isn’t on the board anymore.' : 'That note isn’t on the board anymore.' });
  }, [missing, route.goalId, lastTab, go]);
  const close = () => {
    board.flush();
    go(lastTab);
  };
  const openNote = (id: string) => go(`note-${id}`);
  const openGoal = (id: string) => go(`goal-${id}`);
  const newGoal = () => go('new-goal');

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
      const open = data.notes.filter(n => n.parentId === id && !n.done);
      if (open.length) {
        const count = open.length === 1 ? 'its related task' : `its ${open.length} related tasks`;
        showToast({ text: `Mark ${count} done too?`, actionLabel: 'Mark done', action: () => open.forEach(n => board.setDone(n.id, true)) }, 10_000);
      }
    }
  };

  /** A new to-do linked to the open sticky. */
  const addRelated = (title: string) => {
    if (!selected) return;
    const child = board.addRelatedTask(selected, title);
    const lane = data.lanes.find(l => l.id === child.laneId);
    showToast({ text: `Added to ${lane?.title ?? 'the board'}, linked to this one. It's on the wall now.`, actionLabel: 'Undo', action: () => board.deleteNote(child.id) });
  };

  /** A checklist line becomes its own sticky, linked to this one. */
  const promote = (item: ChecklistItem) => {
    if (!selected) return;
    const parentId = selected.id;
    const before = selected.checklist;
    const child = board.addRelatedTask(selected, item.text.trim(), item.done ? { done: true, doneAt: currentTime().toISOString() } : {});
    board.updateNote(parentId, { checklist: before.filter(i => i.id !== item.id) });
    showToast({
      text: `“${item.text.trim()}” is its own sticky now`,
      actionLabel: 'Undo',
      action: () => {
        board.deleteNote(child.id);
        board.updateNote(parentId, { checklist: before });
      },
    });
  };

  const heardBack = (stage?: Stage) => {
    if (!selected) return;
    const undo = board.heardBack(selected.id, stage);
    if (!undo) return;
    if (!stage) go(lastTab);
    showToast({ text: stage ? `Moved to ${stageLabel(stage, selected.appType)}. No more follow-up nudges.` : 'Marked done. No more follow-up nudges.', actionLabel: 'Undo', action: undo });
  };

  const followedUp = () => {
    if (!selected?.followUp) return;
    const every = selected.followUp.everyDays;
    const undo = board.followedUp(selected.id);
    if (undo) showToast({ text: every ? `Nice. The next nudge is in ${every} days if you don't hear back.` : 'Nice. No more nudges.', actionLabel: 'Undo', action: undo });
  };

  /** "Run now": the board asks the AI within a minute (or the AI picks it up when it checks in). */
  const runAi = () => {
    if (!selected?.ai) return;
    if (__DEMO_BUILD__) {
      showToast({ text: 'In this preview nothing is sent. On the wall computer, the AI is asked within a minute.' }, 7000);
      return;
    }
    board.updateNote(selected.id, { ai: { ...selected.ai, requestedAt: currentTime().toISOString() } });
    showToast({ text: data.settings.ai.connect ? 'Asked for a check now. The AI is asked within a minute.' : 'Saved. Turn on Let an AI connect in Wall → AI helper for it to run.' }, 7000);
  };

  /** Recurring tasks: log a "Did it" and say where that leaves this week. */
  const logRoutine = () => {
    if (!selected) return;
    const id = selected.id;
    const at = board.logRoutine(id);
    const note = board.get().notes.find(n => n.id === id);
    const status = note ? repeatStatus(note, currentTime()) : null;
    if (!status || !at) return;
    const period = status.every === 'day' ? 'today' : status.every === 'week' ? 'this week' : 'this month';
    const back = status.every === 'day' ? 'tomorrow' : status.every === 'week' ? 'on Sunday' : 'on the 1st';
    const text = status.complete ? `Done for ${period}. It comes back ${back}.` : `Nice. ${status.done} of ${status.target} ${period}.`;
    showToast({ text, actionLabel: 'Undo', action: () => board.undoRoutine(id, at) });
  };

  /** The column picker in a note: moving can turn it into a recurring task or back. */
  const changeSelected = (patch: Partial<Note>) => {
    if (!selected) return;
    if (patch.laneId && patch.laneId !== selected.laneId) {
      moveNote(selected.id, patch.laneId);
      return;
    }
    board.updateNote(selected.id, patch);
  };

  /** Dragging a square to another column (computers). */
  const moveNote = (id: string, laneId: string) => {
    const undo = board.moveNote(id, laneId);
    const lane = data.lanes.find(l => l.id === laneId);
    if (undo) showToast({ text: `Moved to ${lane?.title || 'another column'}`, actionLabel: 'Undo', action: undo });
  };

  const changeDraft = (patch: Partial<Note>) =>
    setDraft(d => {
      if (!d) return d;
      if (patch.laneId && patch.laneId !== d.laneId) return applyPatch(d, laneChange(d, data.lanes, patch.laneId));
      return { ...d, ...patch };
    });

  const addGoalDraft = () => {
    if (!goalDraft) return;
    board.addGoal(goalDraft);
    showToast({ text: 'Goal added. Its progress bar is on the wall now.' });
    go(lastTab);
  };

  const deleteGoal = () => {
    if (!selectedGoal) return;
    const removed = board.deleteGoal(selectedGoal.id);
    go(lastTab);
    if (removed) showToast({ text: `Deleted “${removed.title}”`, actionLabel: 'Undo', action: () => board.restoreGoal(removed) });
  };

  const editor: ReactNode = goalDraft ? (
    <GoalEditor
      key={goalDraft.id}
      goal={goalDraft}
      notes={data.notes}
      now={now}
      mode="new"
      onChange={patch => setGoalDraft(g => (g ? { ...g, ...patch } : g))}
      onClose={close}
      onAdd={addGoalDraft}
    />
  ) : selectedGoal ? (
    <GoalEditor
      key={selectedGoal.id}
      goal={selectedGoal}
      notes={data.notes}
      now={now}
      mode="edit"
      onChange={patch => board.updateGoal(selectedGoal.id, patch)}
      onClose={close}
      onDelete={deleteGoal}
    />
  ) : draft ? (
    <NoteEditor
      key={draft.id}
      note={draft}
      lanes={data.lanes}
      notes={data.notes}
      mode="new"
      now={now}
      onChange={changeDraft}
      onClose={close}
      onAdd={addDraft}
    />
  ) : selected ? (
    <NoteEditor
      key={selected.id}
      note={selected}
      lanes={data.lanes}
      mode="edit"
      now={now}
      onChange={changeSelected}
      onClose={close}
      onDelete={deleteSelected}
      onToggleDone={toggleDone}
      onLog={logRoutine}
      onUndoLog={() => board.undoRoutine(selected.id)}
      notes={data.notes}
      onOpenNote={openNote}
      onAddRelated={addRelated}
      onPromote={promote}
      onSetDone={(id, done) => board.setDone(id, done)}
      onHeardBack={heardBack}
      onFollowedUp={followedUp}
      onRunAi={runAi}
    />
  ) : null;
  const editorLabel = goalDraft || selectedGoal ? 'Goal details' : 'Note details';

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
        return (
          <BoardTab
            board={data}
            now={now}
            desktop={desktop}
            selectedId={route.noteId}
            selectedGoalId={route.goalId}
            onOpen={openNote}
            onOpenGoal={openGoal}
            onNewGoal={newGoal}
            onMove={moveNote}
          />
        );
    }
  })();

  const pickTemplate = (kind: LaneKind) => {
    setAdding(false);
    go(`new-${kind}`);
  };

  const pickMessage = () => {
    setAdding(false);
    go('new-message');
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
          <main className="ed-main">
            <ActiveReminders board={data} onOpen={openNote} />
            <PairPrompt board={data} />
            {content}
          </main>
          {editor && <aside className="ed-panel" aria-label={editorLabel}>{editor}</aside>}
        </>
      ) : (
        <>
          <header className="ed-top">
            <Brand />
            <LiveBadge />
          </header>
          <main className="ed-scroll">
            <ActiveReminders board={data} onOpen={openNote} />
            <PairPrompt board={data} />
            {content}
          </main>
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
            <div className="layer layer-sheet" role="dialog" aria-modal="true" aria-label={editorLabel}>
              <div className="sheet">{editor}</div>
            </div>
          )}
        </>
      )}
      {adding && (
        <AddMenu
          desktop={desktop}
          onPick={pickTemplate}
          onMessage={pickMessage}
          onGoal={() => {
            setAdding(false);
            newGoal();
          }}
          onClose={() => setAdding(false)}
        />
      )}
      <Toasts />
    </div>
  );
}
