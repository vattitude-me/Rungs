import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Button from '../components/Button';
import IconChip from '../components/IconChip';
import { getProfile, getBaselineLogs, saveBaselineLog } from '../db';
import { applyRetestedMaxes } from '../engine/planGenerator';
import { localDate } from '../engine/dates';
import type { Exercise, Profile } from '../types';

const TESTS: { key: Exercise; name: string; sub: string; icon: string }[] = [
  { key: 'push', name: 'Max push-ups', sub: 'One clean set to failure', icon: '⌃' },
  { key: 'pull', name: 'Max pull-ups', sub: 'Zero is still a fine answer', icon: '⌄' },
  { key: 'squat', name: 'Max squats', sub: 'Full depth, no bouncing', icon: '◍' },
];

const MAX_REPS = 500;

/** A blank field is not zero - it's unanswered. Zero stays a legitimate
 * answer, so the two have to remain distinguishable. */
function parseDraft(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= 0 && n <= MAX_REPS ? n : null;
}

export default function Retest() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [drafts, setDrafts] = useState<Record<Exercise, string>>({ push: '', pull: '', squat: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setDrafts({
        push: String(p.maxes.push),
        pull: String(p.maxes.pull),
        squat: String(p.maxes.squat),
      });
    });
    // A test run from here banks a baseline log, so pick up anything newer
    // than what the profile is carrying.
    getBaselineLogs().then((logs) => {
      if (logs.length === 0) return;
      setDrafts((d) => {
        const next = { ...d };
        for (const log of logs) next[log.exercise] = String(log.maxReps);
        return next;
      });
    });
  }, []);

  if (!profile) return null;

  const errors = TESTS.reduce<Partial<Record<Exercise, string>>>((acc, t) => {
    const raw = drafts[t.key].trim();
    if (raw === '') acc[t.key] = 'Enter a number (0 is fine).';
    else if (!/^\d+$/.test(raw)) acc[t.key] = 'Whole numbers only.';
    else if (Number(raw) > MAX_REPS) acc[t.key] = `That's above ${MAX_REPS}, double-check it.`;
    return acc;
  }, {});
  const valid = TESTS.every((t) => parseDraft(drafts[t.key]) !== null);

  const save = async () => {
    setTouched(true);
    if (!valid || saving) return;
    setSaving(true);
    const maxes: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
    const now = Date.now();
    for (const t of TESTS) {
      const n = parseDraft(drafts[t.key])!;
      maxes[t.key] = n;
      await saveBaselineLog({ id: t.key, exercise: t.key, maxReps: n, testedAt: now });
    }
    await applyRetestedMaxes(profile, maxes, localDate());
    navigate('/today', { replace: true });
  };

  const changed = TESTS.some((t) => parseDraft(drafts[t.key]) !== profile.maxes[t.key]);

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <span className="text-[15px] font-medium">Retest your maxes</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[24px] font-medium tracking-[-0.02em] leading-[1.15]">
          How strong are you now?
        </div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          Your whole plan scales off these: how the day splits, and how big a
          single set gets. Left alone they'd still describe your first week.
        </div>
      </div>

      <div className="flex flex-col gap-2.25">
        {TESTS.map((t) => {
          const err = touched ? errors[t.key] : undefined;
          const parsed = parseDraft(drafts[t.key]);
          const was = profile.maxes[t.key];
          return (
            <div key={t.key} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-3.5 p-3.5 rounded-[14px] bg-surface shadow-sm">
                <IconChip exercise={t.key}>{t.icon}</IconChip>
                <span className="flex-1 flex flex-col gap-px">
                  <span className="text-[14.5px] font-medium">{t.name}</span>
                  <span className="text-[11.5px] text-neutral-500">
                    {parsed !== null && parsed !== was ? `Was ${was}` : t.sub}
                  </span>
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_REPS}
                  aria-label={t.name}
                  placeholder="—"
                  value={drafts[t.key]}
                  onChange={(e) => setDrafts((d) => ({ ...d, [t.key]: e.target.value }))}
                  className="w-19 h-11 px-3 rounded-[11px] bg-bg text-center text-[16px] tabular-nums text-text outline-none border focus-visible:border-accent"
                  style={{ borderColor: err ? '#e0645f' : 'transparent' }}
                />
              </div>
              {err && <span className="text-[11px] text-[#e0645f] px-1">{err}</span>}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => navigate('/session?exercise=push&mode=baseline&from=retest')}
        className="p-3.5 rounded-xl bg-accent-900 text-left cursor-pointer"
      >
        <span className="text-xs leading-[1.5] text-accent-200">
          Rather count a real set? Run a max test and the number lands here.
        </span>
      </button>

      <div className="mt-auto">
        <Button
          variant="primary" block className="h-12 text-[15px]"
          disabled={saving}
          onClick={save}
        >
          {saving ? 'Rebuilding your day…' : changed ? 'Save and rebuild my day' : 'Keep these numbers'}
        </Button>
      </div>
    </div>
  );
}
