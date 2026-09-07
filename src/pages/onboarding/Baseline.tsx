import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, X } from 'lucide-react';
import Button from '../../components/Button';
import IconChip from '../../components/IconChip';
import { getBaselineLogs, saveBaselineLog } from '../../db';
import type { Exercise } from '../../types';

const TESTS: { key: Exercise; name: string; sub: string; icon: string }[] = [
  { key: 'push', name: 'Max push-ups', sub: 'One clean set to failure', icon: '⌃' },
  { key: 'pull', name: 'Max pull-ups', sub: 'Zero is a fine answer', icon: '⌄' },
  { key: 'squat', name: 'Max squats', sub: 'Full depth, no bouncing', icon: '◍' },
];

const MAX_REPS = 500;

export default function Baseline() {
  const navigate = useNavigate();
  const location = useLocation();
  const navState = (location.state as { name?: string } | null) ?? {};
  const [tested, setTested] = useState<Record<Exercise, number | null>>({ push: null, pull: null, squat: null });
  const [typing, setTyping] = useState(false);
  const [drafts, setDrafts] = useState<Record<Exercise, string>>({ push: '', pull: '', squat: '' });
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    getBaselineLogs().then((logs) => {
      const latest: Record<Exercise, number | null> = { push: null, pull: null, squat: null };
      for (const log of logs) latest[log.exercise] = log.maxReps;
      setTested(latest);
      setDrafts({
        push: latest.push !== null ? String(latest.push) : '',
        pull: latest.pull !== null ? String(latest.pull) : '',
        squat: latest.squat !== null ? String(latest.squat) : '',
      });
    });
  }, []);

  const allTested = TESTS.every((t) => tested[t.key] !== null);

  /** A blank field is not zero - it's unanswered. Zero is a legitimate answer
   * (especially for pull-ups), so the two have to stay distinguishable. */
  const parseDraft = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const n = Number(trimmed);
    return n >= 0 && n <= MAX_REPS ? n : null;
  };

  const draftErrors = TESTS.reduce<Partial<Record<Exercise, string>>>((acc, t) => {
    const raw = drafts[t.key].trim();
    if (raw === '') acc[t.key] = 'Enter a number (0 is fine).';
    else if (!/^\d+$/.test(raw)) acc[t.key] = 'Whole numbers only.';
    else if (Number(raw) > MAX_REPS) acc[t.key] = `That's above ${MAX_REPS}, double-check it.`;
    return acc;
  }, {});

  const draftsValid = TESTS.every((t) => parseDraft(drafts[t.key]) !== null);

  const saveTyped = async () => {
    setTouched(true);
    if (!draftsValid) return;
    const next: Record<Exercise, number | null> = { push: null, pull: null, squat: null };
    for (const t of TESTS) {
      const n = parseDraft(drafts[t.key])!;
      next[t.key] = n;
      await saveBaselineLog({ id: t.key, exercise: t.key, maxReps: n, testedAt: Date.now() });
    }
    setTested(next);
    setTyping(false);
    setTouched(false);
  };

  return (
    <div className="route-forward relative h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate('/onboarding/name')}><ChevronLeft size={18} /></Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '66%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">2 of 3</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[27px] font-medium tracking-[-0.02em]">Let's find your floor</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          One honest max set each. Three push-ups is a completely fine answer. The plan is built from wherever you actually are.
        </div>
      </div>

      <div className="flex flex-col gap-2.25">
        {TESTS.map((t) => {
          const val = tested[t.key];
          return (
            <div
              key={t.key}
              onClick={() => navigate(`/session?exercise=${t.key}&mode=baseline`, { state: navState })}
              className="flex items-center gap-3.5 p-3.5 rounded-[14px] bg-surface shadow-sm cursor-pointer"
            >
              <IconChip exercise={t.key}>{t.icon}</IconChip>
              <span className="flex-1 flex flex-col gap-px">
                <span className="text-[15px] font-medium">{t.name}</span>
                <span className="text-[11.5px] text-neutral-500">{t.sub}</span>
              </span>
              <span
                className="text-xs tabular-nums"
                style={{ color: val !== null ? '#d2cefd' : '#75798c' }}
              >
                {val !== null ? `${val} reps` : 'Test →'}
              </span>
            </div>
          );
        })}
      </div>

      <div className="p-3.5 rounded-xl bg-accent-900 flex gap-2.5 items-start">
        <span className="text-sm leading-tight">◎</span>
        <span className="text-xs leading-[1.5] text-accent-200">
          Can't do a pull-up yet? Say zero. You'll start on rows and negatives and we'll ladder you up to the bar.
        </span>
      </div>

      <div className="mt-auto flex flex-col gap-2">
        <Button
          variant="primary" block className="h-12 text-[15px]"
          disabled={!allTested}
          onClick={() => navigate('/onboarding/schedule', { state: navState })}
        >
          {allTested ? 'Next: pick my windows' : 'Test all three to continue'}
        </Button>
        <Button variant="ghost" block onClick={() => { setTyping(true); setTouched(false); }}>
          I'll type my numbers instead
        </Button>
      </div>

      {typing && (
        <div
          className="fixed inset-0 z-30 flex flex-col justify-end"
          style={{ background: 'rgba(11,12,20,.6)' }}
          onClick={() => setTyping(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface rounded-t-[20px] px-5 pt-4 pb-action flex flex-col gap-3.5 max-h-[85%] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium">Type your numbers</span>
              <span
                onClick={() => setTyping(false)}
                className="w-8 h-8 rounded-full grid place-items-center cursor-pointer text-neutral-400"
                style={{ background: 'rgba(233,233,237,.07)' }}
              >
                <X size={15} />
              </span>
            </div>
            <div className="text-[12.5px] leading-[1.5] text-neutral-400">
              Your best single set for each, as of today. Be honest, the whole plan scales off these.
            </div>

            {TESTS.map((t) => {
              const err = touched ? draftErrors[t.key] : undefined;
              return (
                <div key={t.key} className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-3">
                    <IconChip exercise={t.key} size={34}>{t.icon}</IconChip>
                    <span className="flex-1 text-[14px]">{t.name}</span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={MAX_REPS}
                      placeholder="—"
                      value={drafts[t.key]}
                      onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                      className="w-20 h-11 px-3 rounded-[11px] bg-bg text-center text-[16px] tabular-nums text-text outline-none border focus-visible:border-accent"
                      style={{ borderColor: err ? 'rgba(252,165,165,.5)' : 'transparent' }}
                    />
                  </div>
                  {err && <span className="text-[11px] text-red-300 pl-[46px]">{err}</span>}
                </div>
              );
            })}

            <Button variant="primary" block className="h-12 text-[15px] mt-1" onClick={saveTyped}>
              Save my numbers
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
