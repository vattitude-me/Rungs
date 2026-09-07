import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, Minus, Plus } from 'lucide-react';
import Button from '../../components/Button';
import { getBaselineLogs } from '../../db';
import { computeTierTargets, splitIntoWindows, splitIntoSets } from '../../engine/coach';
import type { Exercise } from '../../types';
import { EXERCISE_LABELS } from '../../types';

interface ProposedWindow {
  time: string;
  body: string;
  len: string;
}

// Placeholder shown for the instant before the real baseline logs load.
const PLACEHOLDER_MAXES: Record<Exercise, number> = { push: 12, pull: 3, squat: 25 };
const WAKE = '06:30';
const SLEEP = '23:00';
const SECONDS_PER_REP = 4;

// Matches the range Settings offers, so the schedule the user builds here is
// one they can keep editing later with the same limits.
const MIN_WINDOWS = 2;
const MAX_WINDOWS = 6;
const DEFAULT_WINDOWS = 4;

/** Spreads `count` windows evenly between 09:00 and 19:00. Same spacing Settings
 * uses when a window is added or removed, so the two screens agree. */
function evenTimes(count: number): string[] {
  const start = 9 * 60;
  const end = 19 * 60;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => {
    const m = Math.round(start + step * i);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
}

/** Builds the proposed day from the real tier-100 split, so what's previewed
 * here is what actually gets scheduled - not illustrative placeholder text. */
function buildProposal(maxes: Record<Exercise, number>, times: string[]): ProposedWindow[] {
  const targets = computeTierTargets(maxes, 100);
  return splitIntoWindows(targets, times.length, WAKE, SLEEP, times).map((w) => {
    const items = splitIntoSets(w.items, maxes);
    const reps = items.reduce((a, it) => a + it.reps, 0);
    return {
      time: w.at,
      body: items.map((it) => `${it.reps} ${EXERCISE_LABELS[it.exercise].toLowerCase()}`).join(' + '),
      len: `about ${Math.max(1, Math.round((reps * SECONDS_PER_REP) / 60))} min`,
    };
  });
}

const COUNT_WORDS = ['', '', 'two', 'three', 'four', 'five', 'six'];

export default function Schedule() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as Record<string, unknown> | null) ?? {};

  // Times are the source of truth; the rep split is derived from them, so
  // changing the count or a single time re-cuts the preview the same way the
  // real plan will be cut.
  const [times, setTimes] = useState<string[]>(() => evenTimes(DEFAULT_WINDOWS));
  const [maxes, setMaxes] = useState<Record<Exercise, number>>(PLACEHOLDER_MAXES);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftTime, setDraftTime] = useState('');

  useEffect(() => {
    getBaselineLogs().then((logs) => {
      if (logs.length === 0) return;
      const m: Record<Exercise, number> = { ...PLACEHOLDER_MAXES };
      for (const log of logs) m[log.exercise] = log.maxReps;
      setMaxes(m);
    });
  }, []);

  const proposal = buildProposal(maxes, times);

  const setCount = (count: number) => {
    if (count < MIN_WINDOWS || count > MAX_WINDOWS) return;
    // Re-space the whole day rather than dropping the last row, so windows stay
    // evenly spread instead of bunching up at one end.
    setTimes(evenTimes(count));
    setEditingIndex(null);
  };

  const openEditor = (i: number) => {
    setEditingIndex(i);
    setDraftTime(times[i]);
  };

  const saveTime = () => {
    if (editingIndex === null || !draftTime) { setEditingIndex(null); return; }
    const next = [...times];
    next[editingIndex] = draftTime;
    next.sort((a, b) => a.localeCompare(b));
    setTimes(next);
    setEditingIndex(null);
  };

  const handleBuildPlan = () => {
    navigate('/onboarding/plan', { state: { ...navState, windows: times } });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-3.75">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate('/onboarding/baseline', { state: navState })}><ChevronLeft size={18} /></Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '100%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">3 of 3</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[27px] font-medium tracking-[-0.02em]">Here's the day we'd build</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          Your 100 reps, cut into {COUNT_WORDS[times.length]} short windows. Change how many
          you want, or tap a time to move it.
        </div>
      </div>

      <div className="flex items-center justify-between px-0.5">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">WINDOWS A DAY</span>
        <div className="flex items-center gap-2">
          <span className="text-[13px] tabular-nums font-medium w-4 text-center">{times.length}</span>
          <button
            type="button"
            aria-label="One less window"
            disabled={times.length <= MIN_WINDOWS}
            onClick={() => setCount(times.length - 1)}
            className="w-6.5 h-6.5 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Minus size={13} />
          </button>
          <button
            type="button"
            aria-label="One more window"
            disabled={times.length >= MAX_WINDOWS}
            onClick={() => setCount(times.length + 1)}
            className="w-6.5 h-6.5 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
          >
            <Plus size={13} />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        {proposal.map((w, i) => (
          <div key={i} className="flex flex-col gap-2">
            <div
              onClick={() => openEditor(i)}
              className="flex items-center gap-3 px-3.25 py-3 rounded-[13px] bg-surface shadow-sm cursor-pointer"
            >
              <span className="text-[13px] tabular-nums font-medium w-13 flex-none text-accent-300">{w.time}</span>
              <span className="flex-1 flex flex-col gap-0.5">
                <span className="text-[13px]">{w.body}</span>
                <span className="text-[11px] text-neutral-500">{w.len}</span>
              </span>
              <span className="w-5.5 h-5.5 flex-none grid place-items-center text-neutral-600 text-[13px]">›</span>
            </div>
            {editingIndex === i && (
              <div className="flex items-center gap-2.5 px-3.25 py-3 rounded-[13px] bg-accent-900">
                <input
                  type="time"
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                  className="flex-1 h-9 px-2.5 rounded-lg bg-surface border border-neutral-800 text-sm text-text outline-none focus-visible:border-accent"
                />
                <Button variant="secondary" className="h-9 px-3 text-xs flex-none" onClick={() => setEditingIndex(null)}>Cancel</Button>
                <Button variant="primary" className="h-9 px-3 text-xs flex-none" onClick={saveTime}>Save</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <span className="text-[11px] leading-[1.5] text-neutral-600 px-0.5">
        Miss one and the coach moves those reps into your later windows. You can
        change all of this later in Settings.
      </span>

      <div className="mt-auto">
        <Button variant="primary" block className="h-12 text-[15px]" onClick={handleBuildPlan}>
          Build my plan
        </Button>
      </div>
    </div>
  );
}
