import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Button from '../../components/Button';
import IconChip from '../../components/IconChip';
import { getBaselineLogs, saveProfile } from '../../db';
import { computeTierTargets } from '../../engine/coach';
import { localDate } from '../../engine/dates';
import type { BarAccess, Exercise, Profile, PullRung, RowEquipment, Tier } from '../../types';
import { EXERCISE_LABELS, EXERCISE_ICON, PULL_RUNG_LABELS, ROW_EQUIPMENT_LABELS, TIERS } from '../../types';

interface OnboardingState {
  name?: string;
  windows?: string[];
  reflow?: boolean;
  barAccess?: BarAccess;
  pullRung?: PullRung;
  rowEquipment?: RowEquipment;
}

const FIRST_TIER: Tier = 100;

export default function PlanPreview() {
  const navigate = useNavigate();
  const location = useLocation();
  const state = (location.state as OnboardingState | null) ?? {};

  const [maxes, setMaxes] = useState<Record<Exercise, number> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getBaselineLogs().then((logs) => {
      const m: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
      for (const log of logs) m[log.exercise] = log.maxReps;
      setMaxes(m);
    });
  }, []);

  if (!maxes) return null;

  const targets = computeTierTargets(maxes, FIRST_TIER);
  const rung = state.pullRung ?? 2;
  const barAccess = state.barAccess ?? 'doorway';
  const windowCount = state.windows?.length ?? 4;

  const perWindow = (ex: Exercise) => Math.max(1, Math.round(targets[ex] / windowCount));

  const handleStart = async () => {
    if (saving) return;
    setSaving(true);
    const today = localDate();
    const profile: Profile = {
      id: 'me',
      name: state.name?.trim() || 'Athlete',
      createdAt: Date.now(),
      maxes,
      pullRung: rung,
      barAccess,
      rowEquipment: state.rowEquipment,
      wake: state.windows?.[0] ?? '06:30',
      sleep: '23:00',
      windowCount,
      // Keep the times the user actually picked on the schedule screen, so the
      // generated day matches the preview instead of being re-spaced from wake.
      windowTimes: state.windows,
      reflow: state.reflow ?? true,
      onboardingComplete: true,
      baselineComplete: true,
      tier: FIRST_TIER,
      tierStartedAt: today,
    };
    await saveProfile(profile);
    navigate('/today', { replace: true });
  };

  const pullLabel = PULL_RUNG_LABELS[rung].toLowerCase();
  const rowNote = state.rowEquipment
    ? ROW_EQUIPMENT_LABELS[state.rowEquipment].toLowerCase()
    : null;

  const rows: { key: Exercise; sub: string }[] = [
    {
      key: 'push',
      sub: `Max ${maxes.push} · about ${perWindow('push')} per window`,
    },
    {
      key: 'pull',
      sub: rung === 0 && rowNote
        ? `Max ${maxes.pull} · ${rowNote} · about ${perWindow('pull')} per window`
        : `Max ${maxes.pull} · ${pullLabel} · about ${perWindow('pull')} per window`,
    },
    {
      key: 'squat',
      sub: `Max ${maxes.squat} · about ${perWindow('squat')} per window`,
    },
  ];

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate('/onboarding/schedule', { state })}>
          <ChevronLeft size={18} />
        </Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '100%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">Your plan</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[10px] tracking-[0.14em] text-accent">STARTING TIER · 100 A DAY</div>
        <div className="text-[27px] font-medium tracking-[-0.02em]">
          {state.name?.trim() ? `${state.name.trim()}, here's day one` : "Here's day one"}
        </div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          100 reps a day to start, split by what you're strongest at and cut into{' '}
          {windowCount} short windows. Hold it for two weeks and you move up to 200.
        </div>
      </div>

      {/* The three tiers, with the current one lit. This is the whole arc of the
          app in one row - where you start, and what "done" actually looks like. */}
      <div
        className="p-4 rounded-[14px] shadow-sm flex flex-col gap-3"
        style={{ background: 'linear-gradient(150deg, #1d2033, #161826)' }}
      >
        <div className="text-[10px] tracking-[0.12em] text-accent">THE LADDER</div>
        <div className="flex items-stretch gap-2">
          {TIERS.map((t) => {
            const active = t === FIRST_TIER;
            return (
              <div
                key={t}
                className="flex-1 flex flex-col gap-1.5 px-2.5 py-3 rounded-[11px]"
                style={{
                  background: active ? 'rgba(145,132,217,.18)' : 'rgba(233,233,237,.04)',
                  boxShadow: active ? 'inset 0 0 0 1px rgba(145,132,217,.5)' : 'none',
                }}
              >
                <span
                  className="text-[22px] font-medium tabular-nums leading-none"
                  style={{ color: active ? '#d2cefd' : '#75798c' }}
                >
                  {t}
                </span>
                <span className="text-[10px] leading-[1.3] text-neutral-500">
                  {t === 100 ? 'reps a day, mixed' : t === 200 ? 'once 100 is routine' : '100 of each, done'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="text-[11px] tracking-[0.1em] text-neutral-500">TODAY'S 100, SPLIT</div>
        {rows.map((r) => (
          <div key={r.key} className="flex items-center gap-3.25 px-3.5 py-3.25 rounded-[13px] bg-surface shadow-sm">
            <IconChip exercise={r.key} size={34}>{EXERCISE_ICON[r.key]}</IconChip>
            <span className="flex-1 flex flex-col gap-px">
              <span className="text-[14.5px] font-medium">{EXERCISE_LABELS[r.key]}</span>
              <span className="text-[11.5px] text-neutral-500">{r.sub}</span>
            </span>
            <span className="text-right flex flex-col gap-px">
              <span className="text-base font-medium tabular-nums">{targets[r.key]}</span>
              <span className="text-[10px] text-neutral-600">today</span>
            </span>
          </div>
        ))}
        <div className="flex items-baseline justify-between px-1 pt-0.5">
          <span className="text-[11.5px] text-neutral-500">Daily total</span>
          <span className="text-[13px] font-medium tabular-nums text-accent-200">
            {targets.push + targets.pull + targets.squat} reps
          </span>
        </div>
      </div>

      <div className="mt-auto">
        <Button variant="primary" block className="h-12 text-[15px]" disabled={saving} onClick={handleStart}>
          {saving ? 'Building…' : 'Start day 1'}
        </Button>
      </div>
    </div>
  );
}
