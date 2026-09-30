import { useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Bell, ChevronLeft, Repeat2 } from 'lucide-react';
import Button from '../../components/Button';
import IconChip from '../../components/IconChip';
import Toggle from '../../components/Toggle';
import MovementPicker, { LevelDots } from '../../components/MovementPicker';
import { saveProfile, getSettings, saveSettings } from '../../db';
import { computeTierTargets } from '../../engine/coach';
import { generateDayPlan } from '../../engine/planGenerator';
import { localDate, dayIndexFor } from '../../engine/dates';
import { evenTimes, timesForDate, DEFAULT_SPREAD_COUNT } from '../../engine/schedule';
import { isNative, requestNotificationPermission, scheduleWindowReminders } from '../../engine/notifications';
import { movementFor, type Movement } from '../../data/movements';
import type { Exercise, Profile, PullRung } from '../../types';
import { EXERCISE_ICON, EXERCISE_COLOR, SLOT_LABELS } from '../../types';
import type { SetupDraft } from './Setup';

const notificationsSupported = isNative() || (typeof window !== 'undefined' && 'Notification' in window);
const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

/** Legacy pull-up rung, still carried on the profile for older builds. */
function legacyRung(pullMax: number): PullRung {
  if (pullMax >= 8) return 4;
  if (pullMax >= 3) return 3;
  if (pullMax >= 1) return 2;
  return 1;
}

function buildProfile(d: SetupDraft, variations: Partial<Record<Exercise, string>>): Profile {
  const today = localDate();
  const windowTimes =
    d.dayStyle === 'single' ? [d.singleAt]
      : d.dayStyle === 'spread' ? evenTimes(DEFAULT_SPREAD_COUNT)
        : undefined;
  return {
    id: 'me',
    name: '',
    createdAt: Date.now(),
    maxes: d.maxes,
    maxesEstimated: d.maxesEstimated,
    level: d.level,
    pullRung: legacyRung(d.maxes.pull),
    barAccess: d.equipment.includes('bar') ? 'doorway' : 'none',
    equipment: d.equipment,
    dayStyle: d.dayStyle,
    focus: 'balanced',
    variations,
    wake: '06:30',
    sleep: '23:00',
    windowCount: windowTimes?.length ?? DEFAULT_SPREAD_COUNT,
    windowTimes,
    onboardingComplete: true,
    baselineComplete: true,
    lastRebaselineAt: today,
    tier: 100,
    tierStartedAt: today,
    units: 'metric',
  };
}

function scheduleLine(p: Profile, times: string[]): string {
  if (p.dayStyle === 'single') return `One session at ${times[0]}, about 15 minutes.`;
  if (p.dayStyle === 'surprise') return `${times.length} sets at random times between 9am and 8:30pm. We'll ping you.`;
  return `${times.length} short sets at ${times.join(', ')}. Change them any time.`;
}

/** The reveal: your first day, with every movement one tap from being
 * swapped. This is where "choose your workout" lives in onboarding - shown,
 * not asked, so nobody has to decide anything they don't care about. */
export default function Ready() {
  const navigate = useNavigate();
  const location = useLocation();
  const draft = location.state as SetupDraft | null;

  const [variations, setVariations] = useState<Partial<Record<Exercise, string>>>({});
  const [picking, setPicking] = useState<Exercise | null>(null);
  const [remindersOn, setRemindersOn] = useState(true);
  const [saving, setSaving] = useState(false);

  const profile = useMemo(() => (draft?.maxes ? buildProfile(draft, variations) : null), [draft, variations]);
  if (!draft?.maxes || !profile) return <Navigate to="/onboarding/level" replace />;

  const targets = computeTierTargets(profile.maxes, 100, profile.focus);
  const times = timesForDate(profile, localDate());
  const moves: Record<Exercise, Movement> = {
    push: movementFor(profile, 'push'),
    pull: movementFor(profile, 'pull'),
    squat: movementFor(profile, 'squat'),
  };

  const start = async () => {
    if (saving) return;
    setSaving(true);
    // Only the slots the user actually changed are pinned; the rest keep
    // following their level, so they move up the ladder on their own.
    await saveProfile(profile);
    const today = localDate();
    const plan = await generateDayPlan(today, dayIndexFor(profile.createdAt, today), profile);

    if (remindersOn && notificationsSupported) {
      const granted = await requestNotificationPermission();
      if (granted) {
        const settings = await getSettings();
        await saveSettings({ ...settings, reminders: true });
        await scheduleWindowReminders(plan, profile);
      }
    }
    navigate('/today', { replace: true });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4.5">
      <div className="flex items-center gap-3">
        <Button variant="icon" aria-label="Back" onClick={() => navigate('/onboarding/setup', { state: draft })}>
          <ChevronLeft size={18} />
        </Button>
        <span className="text-[11px] tracking-[0.14em] text-accent">YOUR PLAN IS READY</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[28px] leading-[1.1] font-semibold tracking-[-0.025em]">Day one: 100 reps</h1>
        <p className="text-[13.5px] leading-[1.5] text-neutral-400">{scheduleLine(profile, times)}</p>
      </div>

      <div className="flex flex-col gap-2">
        {EXERCISES.map((ex) => {
          const m = moves[ex];
          return (
            <button
              type="button"
              key={ex}
              onClick={() => setPicking(ex)}
              className="flex items-center gap-3.25 px-3.5 py-3.25 rounded-[15px] bg-surface shadow-sm text-left cursor-pointer active:scale-[0.99] transition-transform"
            >
              <IconChip exercise={ex} size={40}><span className="text-[16px]">{EXERCISE_ICON[ex]}</span></IconChip>
              <span className="flex-1 flex flex-col gap-1 min-w-0">
                <span className="text-[10.5px] tracking-[0.1em]" style={{ color: EXERCISE_COLOR[ex] }}>{SLOT_LABELS[ex].toUpperCase()}</span>
                <span className="text-[15px] font-medium truncate">{m.name}</span>
                <LevelDots level={m.level} color={EXERCISE_COLOR[ex]} />
              </span>
              <span className="flex flex-col items-end gap-1 flex-none">
                <span className="text-[20px] font-semibold tabular-nums leading-none">{targets[ex]}</span>
                <span className="flex items-center gap-1 text-[11px] text-accent-300"><Repeat2 size={12} /> Swap</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="text-[11.5px] leading-[1.5] text-neutral-600 px-0.5">
        Split to your strength. Hold it for two weeks and you climb to 200, then 300: a hundred of each.
      </p>

      {notificationsSupported && (
        <div className="flex items-center gap-3 p-3.25 rounded-[14px] bg-surface shadow-sm">
          <IconChip size={34}><Bell size={16} /></IconChip>
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium">Remind me</span>
            <span className="text-[11.5px] text-neutral-500">A nudge a few minutes before each set.</span>
          </span>
          <Toggle label="Remind me" on={remindersOn} onToggle={() => setRemindersOn((r) => !r)} />
        </div>
      )}

      <div className="mt-auto">
        <Button variant="solid" block className="h-13 text-[15.5px] rounded-[14px]" disabled={saving} onClick={start}>
          {saving ? 'Setting up…' : <>Let's go <ArrowRight size={17} /></>}
        </Button>
      </div>

      {picking && (
        <MovementPicker
          slot={picking}
          equipment={draft.equipment}
          currentId={moves[picking].id}
          onPick={(m) => { setVariations((v) => ({ ...v, [picking]: m.id })); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
