import { useEffect, useState } from 'react';
import StatCard from '../components/StatCard';
import IconChip from '../components/IconChip';
import { getStreak, getAllDayRecords, getAllSetLogs } from '../db';
import { localDate } from '../engine/dates';
import type { StreakData, DayRecord, SetLog, Exercise } from '../types';
import { EXERCISE_LABELS, EXERCISE_COLOR, EXERCISE_CHIP_BG, EXERCISE_ICON } from '../types';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

// Levels 0-4: none, started, halfway, 75%+ (brighter), 100% (gold - the payoff color).
const CAL_BG = [
  'color-mix(in srgb, var(--color-text) 5%, transparent)',
  'var(--color-accent-900)',
  'var(--color-accent-700)',
  'var(--color-accent-400)',
  'var(--color-gold)',
];
const CAL_TEXT = [
  'var(--color-neutral-600)',
  'var(--color-neutral-500)',
  'var(--color-accent-100)',
  'var(--color-bg)',
  'var(--color-bg)',
];

/** A day in one of the charts, with the date it stands for. The week chart
 * used to label its columns M-T-W-T-F-S-S whatever day it was, over a window
 * that actually ends today - so on a Wednesday every label was wrong. */
interface ChartDay {
  date: Date;
  record: DayRecord | undefined;
}

function lastDays(count: number, byDate: Map<string, DayRecord>): ChartDay[] {
  const today = new Date();
  return Array.from({ length: count }, (_, k) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (count - 1 - k));
    return { date: d, record: byDate.get(localDate(d)) };
  });
}

const weekdayInitial = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'narrow' });

function levelFromPct(pct: number): number {
  if (pct <= 0) return 0;
  if (pct < 50) return 1;
  if (pct < 75) return 2;
  if (pct < 100) return 3;
  return 4;
}

export default function Progress() {
  const [streak, setStreak] = useState<StreakData | null>(null);
  const [totalReps, setTotalReps] = useState(0);
  const [week, setWeek] = useState<ChartDay[]>([]);
  const [month, setMonth] = useState<ChartDay[]>([]);
  const [bests, setBests] = useState<Record<Exercise, number>>({ push: 0, pull: 0, squat: 0 });

  useEffect(() => {
    getStreak().then(setStreak);

    getAllDayRecords().then((records) => {
      const total = records.reduce((sum, r) => sum + Object.values(r.exercises).reduce((s, e) => s + e.completed, 0), 0);
      setTotalReps(total);

      const byDate = new Map(records.map((r) => [r.date, r]));
      setWeek(lastDays(7, byDate));
      setMonth(lastDays(28, byDate));
    });

    getAllSetLogs().then((logs: SetLog[]) => {
      const best: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
      for (const log of logs) best[log.exercise] = Math.max(best[log.exercise], log.reps);
      setBests(best);
    });
  }, []);

  const weekRecords = week.map((d) => d.record);
  const monthRecords = month.map((d) => d.record);
  const weekMaxCompleted = Math.max(1, ...weekRecords.flatMap((r) => r ? Object.values(r.exercises).map((e) => e.completed) : [0]));
  const monthCompletePct = monthRecords.length
    ? Math.round((100 * monthRecords.filter((r) => r?.streakCredit).length) / monthRecords.filter(Boolean).length || 0)
    : 0;
  const todayKey = localDate();

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col px-5 pt-4 pb-24 gap-3.75">
      <h1 className="text-[22px] font-medium tracking-[-0.02em]">Progress</h1>

      <div className="flex gap-2.5 items-stretch">
        <div
          className="flex-1 p-[15px] rounded-[15px] shadow-sm flex flex-col gap-0.5"
          style={{ background: 'linear-gradient(150deg, var(--color-lit-from), var(--color-lit-to))' }}
        >
          <span className="text-[10px] tracking-[0.12em] text-accent">STREAK</span>
          <span className="text-[34px] font-medium leading-[1.1] tabular-nums">{streak?.current ?? 0}</span>
          <span className="text-[11.5px] text-neutral-500">days · best {streak?.longest ?? 0}</span>
        </div>
        <StatCard kicker="TOTAL REPS" kickerAccent={false} value={totalReps.toLocaleString()} caption="since start" />
      </div>

      <div className="p-[15px] rounded-[15px] bg-surface shadow-sm flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium">This week</span>
          <div className="flex gap-2.5 text-[10.5px] text-neutral-500">
            {EXERCISES.map((ex) => (
              <span key={ex} className="flex items-center gap-1">
                <i className="w-2 h-2 rounded-sm block" style={{ background: EXERCISE_COLOR[ex] }} />
                {ex[0].toUpperCase() + ex.slice(1)}
              </span>
            ))}
          </div>
        </div>
        {weekRecords.some(Boolean) ? (
          <>
            <div className="flex items-end justify-between gap-2 h-28">
              {weekRecords.map((rec, i) => (
                <div key={i} className="flex-1 flex items-end gap-0.5 h-full">
                  {EXERCISES.map((ex) => {
                    const completed = rec?.exercises[ex]?.completed ?? 0;
                    const pct = Math.max(2, Math.round((100 * completed) / weekMaxCompleted));
                    return (
                      <i key={ex} style={{ height: `${pct}%`, background: EXERCISE_COLOR[ex] }} className="flex-1 rounded-sm block" />
                    );
                  })}
                </div>
              ))}
            </div>
            <div className="flex justify-between gap-2 text-[10px] text-neutral-600">
              {week.map(({ date }, i) => (
                <span key={i} className={`flex-1 text-center ${i === week.length - 1 ? 'text-text font-medium' : ''}`}>
                  {weekdayInitial(date)}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="text-[12px] text-neutral-500 py-6 text-center">No sets banked yet this week.</div>
        )}
      </div>

      <div className="p-[15px] rounded-[15px] bg-surface shadow-sm flex flex-col gap-2.75">
        <div className="flex items-center justify-between">
          <span className="text-[13px] font-medium">Last 4 weeks</span>
          <span className="text-[11px] text-neutral-500">{monthCompletePct}% complete</span>
        </div>
        <div className="grid grid-cols-7 gap-1.5">
          {month.slice(0, 7).map(({ date }, i) => (
            <span key={`h${i}`} aria-hidden className="text-center text-[9.5px] text-neutral-600">
              {weekdayInitial(date)}
            </span>
          ))}
          {month.map(({ date, record }, i) => {
            const lvl = record ? levelFromPct(record.totalVolumePct) : 0;
            const isToday = localDate(date) === todayKey;
            return (
              <span
                key={i}
                title={date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                style={{
                  background: CAL_BG[lvl],
                  color: CAL_TEXT[lvl],
                  boxShadow: isToday ? 'inset 0 0 0 1.5px var(--color-text)' : undefined,
                }}
                className={`aspect-square rounded-[7px] grid place-items-center text-[10px] tabular-nums ${isToday ? 'font-semibold' : ''}`}
              >
                {date.getDate()}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">PERSONAL BESTS</span>
        {EXERCISES.map((ex) => (
          <div key={ex} className="flex items-center gap-2.75 px-3.25 py-3 rounded-xl bg-surface">
            <IconChip bg={EXERCISE_CHIP_BG[ex]} size={30}>{EXERCISE_ICON[ex]}</IconChip>
            <span className="flex-1 text-[13.5px]">Best {EXERCISE_LABELS[ex].toLowerCase().replace(/s$/, '')} set</span>
            <span className="text-sm font-medium tabular-nums">{bests[ex]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
