import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronLeft, Clock, Minus, Plus, Repeat2, Shuffle, Sun, Waves } from 'lucide-react';
import Button from '../components/Button';
import IconChip from '../components/IconChip';
import ModeChip from '../components/ModeChip';
import MovementPicker, { LevelDots } from '../components/MovementPicker';
import BodyFields, { bodyDraftFrom, parseBody, type BodyDraft } from '../components/BodyFields';
import { getProfile, saveProfile, getSettings, getDayPlan } from '../db';
import { applyProfileToToday } from '../engine/planGenerator';
import { localDate } from '../engine/dates';
import {
  DAY_STYLES, SINGLE_TIMES, MIN_WINDOWS, MAX_WINDOWS, DEFAULT_SPREAD_COUNT, evenTimes, dayStyleOf, timesForDate,
} from '../engine/schedule';
import { cancelWindowReminders, scheduleWindowReminders } from '../engine/notifications';
import { movementFor, equipmentOf, EQUIPMENT_LABELS } from '../data/movements';
import type { DayStyle, Equipment, Exercise, Focus, Profile } from '../types';
import { EXERCISE_COLOR, EXERCISE_ICON, SLOT_LABELS } from '../types';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];
const KIT: Equipment[] = ['bar', 'dumbbell', 'band'];
const STYLE_ICON: Record<DayStyle, typeof Sun> = { spread: Waves, single: Sun, surprise: Shuffle };

const FOCUS_OPTIONS: { key: Focus; label: string }[] = [
  { key: 'balanced', label: 'Balanced' },
  { key: 'upper', label: 'Upper body' },
  { key: 'lower', label: 'Legs' },
];

function SectionLabel({ children, hint }: { children: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between px-0.5">
      <h2 className="text-[11px] tracking-[0.1em] text-neutral-500">{children}</h2>
      {hint && <span className="text-[11px] text-neutral-600">{hint}</span>}
    </div>
  );
}

/** Everything about what a day is made of: moves, kit, when, and focus.
 * Changes that reshape the day re-cut what's left of today straight away;
 * sets already banked stay banked. */
export default function Workout() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [picking, setPicking] = useState<Exercise | null>(null);
  const [editingTime, setEditingTime] = useState<number | null>(null);
  const [timeDraft, setTimeDraft] = useState('');
  const [body, setBody] = useState<BodyDraft | null>(null);
  const [bodySaved, setBodySaved] = useState(false);

  useEffect(() => {
    getProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setBody(bodyDraftFrom(p));
    });
  }, []);

  if (!profile || !body) return null;

  const kit = equipmentOf(profile);
  const style = dayStyleOf(profile);
  const today = localDate();
  const times = timesForDate(profile, today);

  /** For changes that don't touch the day's shape. */
  const save = async (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    await saveProfile(next);
  };

  /** For changes that do: style, times, focus. */
  const reshape = async (patch: Partial<Profile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    const settings = await getSettings();
    const before = await getDayPlan(today);
    if (before && settings.reminders) await cancelWindowReminders(before);
    const rebuilt = await applyProfileToToday(next, today);
    if (rebuilt && settings.reminders) await scheduleWindowReminders(rebuilt, next);
  };

  const toggleKit = (e: Equipment) => {
    const equipment = kit.includes(e) ? kit.filter((x) => x !== e) : [...kit, e];
    void save({ equipment, barAccess: equipment.includes('bar') ? 'doorway' : 'none' });
  };

  const chooseStyle = (s: DayStyle) => {
    if (s === style) return;
    if (s === 'single') {
      void reshape({ dayStyle: s, windowTimes: [SINGLE_TIMES[2].at], windowCount: 1 });
    } else if (s === 'spread') {
      const t = evenTimes(DEFAULT_SPREAD_COUNT);
      void reshape({ dayStyle: s, windowTimes: t, windowCount: t.length });
    } else {
      void reshape({ dayStyle: s, windowCount: Math.max(MIN_WINDOWS, profile.windowCount > 1 ? profile.windowCount : DEFAULT_SPREAD_COUNT) });
    }
  };

  const setCount = (count: number) => {
    if (count < MIN_WINDOWS || count > MAX_WINDOWS) return;
    if (style === 'surprise') void reshape({ windowCount: count });
    else void reshape({ windowTimes: evenTimes(count), windowCount: count });
  };

  const saveTime = () => {
    if (editingTime === null || !timeDraft) { setEditingTime(null); return; }
    const next = [...times];
    next[editingTime] = timeDraft;
    next.sort((a, b) => a.localeCompare(b));
    setEditingTime(null);
    void reshape({ windowTimes: next, windowCount: next.length });
  };

  const saveBody = async () => {
    const parsed = parseBody(body);
    if (!parsed.ok) return;
    await save({ units: body.units, weightKg: parsed.weightKg, heightCm: parsed.heightCm });
    setBodySaved(true);
    setTimeout(() => setBodySaved(false), 1800);
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5 pt-4 pb-action gap-5">
      <div className="flex items-center gap-3">
        <Button variant="icon" aria-label="Back" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <span className="text-[15px] font-medium">Your workout</span>
      </div>

      <section className="flex flex-col gap-2">
        <SectionLabel hint="Tap to swap">MOVES</SectionLabel>
        <div className="rounded-[15px] bg-surface shadow-sm overflow-hidden">
          {EXERCISES.map((ex, i) => {
            const m = movementFor(profile, ex);
            return (
              <button
                type="button"
                key={ex}
                onClick={() => setPicking(ex)}
                className={`w-full flex items-center gap-3 px-3.5 py-3 text-left cursor-pointer active:bg-text/4 ${i ? 'border-t border-neutral-800/60' : ''}`}
              >
                <IconChip exercise={ex} size={34}>{EXERCISE_ICON[ex]}</IconChip>
                <span className="flex-1 flex flex-col gap-1 min-w-0">
                  <span className="text-[10.5px] tracking-[0.1em]" style={{ color: EXERCISE_COLOR[ex] }}>{SLOT_LABELS[ex].toUpperCase()}</span>
                  <span className="text-[14px] font-medium truncate">{m.name}</span>
                </span>
                <LevelDots level={m.level} color={EXERCISE_COLOR[ex]} />
                <Repeat2 size={14} className="text-neutral-600 flex-none" />
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>KIT</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {KIT.map((e) => {
            const on = kit.includes(e);
            return (
              <button
                type="button"
                key={e}
                aria-pressed={on}
                onClick={() => toggleKit(e)}
                className={[
                  'h-10 px-3.5 rounded-full flex items-center gap-1.5 text-[13px] cursor-pointer transition-colors',
                  on ? 'bg-accent/16 text-accent-200 shadow-[inset_0_0_0_1px_var(--color-accent)]' : 'bg-surface text-neutral-300 shadow-sm',
                ].join(' ')}
              >
                {on && <Check size={14} strokeWidth={2.6} />}
                {EQUIPMENT_LABELS[e]}
              </button>
            );
          })}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>YOUR DAY</SectionLabel>
        <div role="radiogroup" className="flex flex-col gap-2">
          {DAY_STYLES.map((s) => {
            const on = s.id === style;
            const Icon = STYLE_ICON[s.id];
            return (
              <button
                type="button"
                role="radio"
                aria-checked={on}
                key={s.id}
                onClick={() => chooseStyle(s.id)}
                className={[
                  'flex items-center gap-3 px-3.5 py-3 rounded-[14px] text-left cursor-pointer transition-all',
                  on ? 'bg-accent/10 shadow-[inset_0_0_0_1.5px_var(--color-accent)]' : 'bg-surface shadow-sm',
                ].join(' ')}
              >
                <span
                  className="w-8.5 h-8.5 flex-none rounded-[10px] grid place-items-center"
                  style={{ background: on ? 'var(--color-accent)' : 'var(--color-neutral-800)', color: on ? 'var(--color-on-accent)' : 'var(--color-neutral-300)' }}
                >
                  <Icon size={15} />
                </span>
                <span className="flex-1 flex flex-col gap-px">
                  <span className="text-[14px] font-medium">{s.title}</span>
                  <span className="text-[11.5px] text-neutral-500">{s.sub}</span>
                </span>
              </button>
            );
          })}
        </div>

        {style !== 'single' && (
          <div className="flex items-center justify-between px-0.5 pt-1">
            <span className="text-[12.5px] text-neutral-400">{style === 'surprise' ? 'Surprise sets a day' : 'Sets a day'}</span>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="One fewer" disabled={times.length <= MIN_WINDOWS} onClick={() => setCount(times.length - 1)}
                className="w-8 h-8 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35">
                <Minus size={13} />
              </button>
              <span className="text-[14px] tabular-nums font-medium w-4 text-center">{times.length}</span>
              <button type="button" aria-label="One more" disabled={times.length >= MAX_WINDOWS} onClick={() => setCount(times.length + 1)}
                className="w-8 h-8 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35">
                <Plus size={13} />
              </button>
            </div>
          </div>
        )}

        {style === 'surprise' ? (
          <span className="text-[11.5px] leading-[1.5] text-neutral-600 px-0.5">
            New times every day between 9am and 8:30pm, at least 75 minutes apart. You'll see each one when it lands.
          </span>
        ) : (
          <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
            {times.map((t, i) => (
              <div key={`${t}-${i}`}>
                <button
                  type="button"
                  onClick={() => { setEditingTime(i); setTimeDraft(t); }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-3 text-left cursor-pointer active:bg-text/4 ${i ? 'border-t border-neutral-800/60' : ''}`}
                >
                  <Clock size={14} className="text-neutral-400" />
                  <span className="flex-1 text-[14px] tabular-nums">{t}</span>
                  <span className="text-[11.5px] text-neutral-600">Change</span>
                </button>
                {editingTime === i && (
                  <div className="flex items-center gap-2.5 px-3.5 py-3 bg-accent-900">
                    <input
                      type="time"
                      value={timeDraft}
                      onChange={(e) => setTimeDraft(e.target.value)}
                      className="flex-1 h-9 px-2.5 rounded-lg bg-surface border border-neutral-800 text-sm text-text outline-none focus-visible:border-accent"
                    />
                    <Button variant="secondary" className="h-9 px-3 text-xs flex-none" onClick={() => setEditingTime(null)}>Cancel</Button>
                    <Button variant="primary" className="h-9 px-3 text-xs flex-none" onClick={saveTime}>Save</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>FOCUS</SectionLabel>
        <ModeChip options={FOCUS_OPTIONS} value={profile.focus ?? 'balanced'} onChange={(focus) => void reshape({ focus })} />
        <span className="text-[11.5px] leading-[1.5] text-neutral-600 px-0.5">
          Tilts the daily split. It evens out as you climb, since 300 a day is a hundred of each.
        </span>
      </section>

      <section className="flex flex-col gap-2">
        <SectionLabel>BODY</SectionLabel>
        <div className="p-3.5 rounded-[15px] bg-surface shadow-sm flex flex-col gap-3">
          <BodyFields value={body} onChange={setBody} showErrors />
          <Button variant="primary" className="h-10 self-start px-4" onClick={() => void saveBody()}>
            {bodySaved ? <><Check size={14} /> Saved</> : 'Save'}
          </Button>
        </div>
      </section>

      {picking && (
        <MovementPicker
          slot={picking}
          equipment={kit}
          currentId={movementFor(profile, picking).id}
          onPick={(m) => { void save({ variations: { ...profile.variations, [picking]: m.id } }); setPicking(null); }}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  );
}
