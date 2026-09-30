import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import Button from '../../components/Button';
import IconChip from '../../components/IconChip';
import Sheet from '../../components/Sheet';
import StepHeader from '../../components/StepHeader';
import { LEVELS, LEVEL_MAXES } from '../../data/movements';
import type { Exercise, FitnessLevel } from '../../types';
import { EXERCISE_ICON, EXERCISE_LABELS } from '../../types';

export interface OnboardingDraft {
  level?: FitnessLevel;
  maxes: Record<Exercise, number>;
  maxesEstimated: boolean;
}

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];
const MAX_REPS = 500;

/** Bars that fill with the level, so the four cards read as a ladder. */
function LevelBars({ n }: { n: number }) {
  return (
    <span className="flex items-end gap-[3px] h-5" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <i
          key={i}
          className="block w-[5px] rounded-[2px]"
          style={{
            height: 6 + i * 4.5,
            background: i <= n ? 'var(--color-accent)' : 'color-mix(in srgb, var(--color-text) 14%, transparent)',
          }}
        />
      ))}
    </span>
  );
}

/** Step 1: where you're starting.
 *
 * This used to be three max tests before anyone saw the app - the most
 * honest numbers, and the biggest drop-off. A tap on a description gets a
 * plan that's close enough for day one; the check-in the next day offers the
 * real test to anyone who wants it. People who already know their numbers
 * can type them. */
export default function Level() {
  const navigate = useNavigate();
  const [typing, setTyping] = useState(false);
  const [drafts, setDrafts] = useState<Record<Exercise, string>>({ push: '', pull: '', squat: '' });
  const [touched, setTouched] = useState(false);

  const go = (draft: OnboardingDraft) => navigate('/onboarding/setup', { state: draft });

  const parse = (raw: string): number | null => {
    const t = raw.trim();
    if (!/^\d+$/.test(t)) return null;
    const n = Number(t);
    return n <= MAX_REPS ? n : null;
  };
  const valid = EXERCISES.every((ex) => parse(drafts[ex]) !== null);

  const saveTyped = () => {
    setTouched(true);
    if (!valid) return;
    const maxes = { push: parse(drafts.push)!, pull: parse(drafts.pull)!, squat: parse(drafts.squat)! };
    setTyping(false);
    go({ maxes, maxesEstimated: false });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-5">
      <StepHeader step={1} of={2} onBack={() => navigate('/onboarding/welcome')} />

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.025em]">Where are you starting?</h1>
        <p className="text-[13.5px] leading-[1.5] text-neutral-400">
          Pick the closest. No test needed, the plan adjusts as you go.
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {LEVELS.map((l, i) => (
          <button
            type="button"
            key={l.id}
            onClick={() => go({ level: l.id, maxes: LEVEL_MAXES[l.id], maxesEstimated: true })}
            className="group flex items-center gap-3.5 px-4 py-4 rounded-[16px] bg-surface shadow-sm text-left cursor-pointer active:scale-[0.99] transition-transform hover:shadow-[0_0_0_1px_var(--color-accent-700)]"
          >
            <LevelBars n={i} />
            <span className="flex-1 flex flex-col gap-0.5">
              <span className="text-[15.5px] font-medium">{l.title}</span>
              <span className="text-[12px] text-neutral-500">{l.sub}</span>
            </span>
            <ChevronRight size={17} className="text-neutral-600 group-hover:text-accent-300 transition-colors" />
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => { setTyping(true); setTouched(false); }}
        className="mt-auto text-[13px] text-neutral-400 py-2 cursor-pointer"
      >
        I know my exact numbers
      </button>

      {typing && (
        <Sheet title="Your best single set" onClose={() => setTyping(false)}>
          <div className="text-[12.5px] leading-[1.5] text-neutral-400">
            Max reps in one go, as of today. Zero is a fine answer for pull-ups.
          </div>
          {EXERCISES.map((ex) => {
            const bad = touched && parse(drafts[ex]) === null;
            return (
              <label key={ex} className="flex items-center gap-3">
                <IconChip exercise={ex} size={34}>{EXERCISE_ICON[ex]}</IconChip>
                <span className="flex-1 text-[14px]">{EXERCISE_LABELS[ex]}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_REPS}
                  placeholder="—"
                  value={drafts[ex]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [ex]: e.target.value }))}
                  className="w-20 h-11 px-3 rounded-[11px] bg-bg text-center text-[16px] tabular-nums text-text outline-none border focus-visible:border-accent"
                  style={{ borderColor: bad ? 'var(--color-danger)' : 'transparent' }}
                />
              </label>
            );
          })}
          {touched && !valid && <span className="text-[11.5px] text-danger-soft">Whole numbers for all three, please.</span>}
          <Button variant="solid" block className="h-12 text-[15px] mt-1" onClick={saveTyped}>Continue</Button>
        </Sheet>
      )}
    </div>
  );
}
