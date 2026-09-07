import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
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
const WINDOW_COUNT = 4;
const SECONDS_PER_REP = 4;

/** Builds the proposed day from the real tier-100 split, so what's previewed
 * here is what actually gets scheduled - not illustrative placeholder text. */
function buildProposal(maxes: Record<Exercise, number>): ProposedWindow[] {
  const targets = computeTierTargets(maxes, 100);
  return splitIntoWindows(targets, WINDOW_COUNT, WAKE, SLEEP).map((w) => {
    const items = splitIntoSets(w.items, maxes);
    const reps = items.reduce((a, it) => a + it.reps, 0);
    return {
      time: w.at,
      body: items.map((it) => `${it.reps} ${EXERCISE_LABELS[it.exercise].toLowerCase()}`).join(' + '),
      len: `about ${Math.max(1, Math.round((reps * SECONDS_PER_REP) / 60))} min`,
    };
  });
}

export default function Schedule() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as Record<string, unknown> | null) ?? {};
  const [proposal, setProposal] = useState<ProposedWindow[]>(() => buildProposal(PLACEHOLDER_MAXES));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [draftTime, setDraftTime] = useState('');

  useEffect(() => {
    getBaselineLogs().then((logs) => {
      if (logs.length === 0) return;
      const m: Record<Exercise, number> = { ...PLACEHOLDER_MAXES };
      for (const log of logs) m[log.exercise] = log.maxReps;
      setProposal(buildProposal(m));
    });
  }, []);

  const openEditor = (i: number) => {
    setEditingIndex(i);
    setDraftTime(proposal[i].time);
  };

  const saveTime = () => {
    if (editingIndex === null || !draftTime) { setEditingIndex(null); return; }
    const next = [...proposal];
    next[editingIndex] = { ...next[editingIndex], time: draftTime };
    next.sort((a, b) => a.time.localeCompare(b.time));
    setProposal(next);
    setEditingIndex(null);
  };

  const handleBuildPlan = () => {
    navigate('/onboarding/plan', {
      state: { ...navState, windows: proposal.map((w) => w.time) },
    });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-3.75">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate('/onboarding/bar', { state: navState })}><ChevronLeft size={18} /></Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '100%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">4 of 4</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[27px] font-medium tracking-[-0.02em]">Here's the day we'd build</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          Your 100 reps, cut into four short windows. Tap a time to change it, and the coach moves reps to
          your later windows if one slips by.
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
              <span className="w-5.5 h-5.5 flex-none grid place-items-center text-neutral-600 text-[13px]">⠿</span>
            </div>
            {editingIndex === i && (
              <div className="flex items-center gap-2.5 px-3.25 py-3 rounded-[13px] bg-accent-900">
                <span className="text-[12px] text-accent-200 flex-1">Set time for this window</span>
                <input
                  type="time"
                  value={draftTime}
                  onChange={(e) => setDraftTime(e.target.value)}
                  className="h-9 px-2.5 rounded-lg bg-surface border border-neutral-800 text-sm text-text outline-none focus-visible:border-accent"
                />
                <Button variant="secondary" className="h-9 px-3 text-xs flex-none" onClick={() => setEditingIndex(null)}>Cancel</Button>
                <Button variant="primary" className="h-9 px-3 text-xs flex-none" onClick={saveTime}>Save</Button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-auto">
        <Button variant="primary" block className="h-12 text-[15px]" onClick={handleBuildPlan}>
          Build my plan
        </Button>
      </div>
    </div>
  );
}
