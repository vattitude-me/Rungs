import type { Exercise, DayPlan, Profile, DayRecord } from '../types';
import {
  computeWindowCount, splitIntoWindows, reflow,
  computeStreakCredit, updateStreak, computeTierTargets, checkTierPromotion,
} from './coach';
import {
  getDayPlan, saveDayPlan, getSetLogs, saveDayRecord, getStreak, saveStreak,
  getAllDayRecords, saveProfile,
} from '../db';
import { timeToMinutes, nowMinutes } from './dates';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

function wakingSpanHours(wake: string, sleep: string): number {
  const w = timeToMinutes(wake);
  let s = timeToMinutes(sleep);
  if (s <= w) s += 24 * 60;
  return (s - w) / 60;
}

export async function generateDayPlan(
  date: string,
  dayIndex: number,
  profile: Profile
): Promise<DayPlan> {
  const existing = await getDayPlan(date);
  if (existing) return existing;

  // Before building a new day, see whether the user has earned the next tier.
  const tier = await resolveTier(profile, date);

  const targets = computeTierTargets(profile.maxes, tier);
  const totalVolume = EXERCISES.reduce((a, ex) => a + targets[ex], 0);

  const span = wakingSpanHours(profile.wake, profile.sleep);
  const windowCount = profile.windowTimes?.length
    || profile.windowCount
    || computeWindowCount(span, totalVolume / EXERCISES.length);
  const windows = splitIntoWindows(targets, windowCount, profile.wake, profile.sleep, profile.windowTimes);

  const dayOfWeek = new Date(date).getDay();
  const model = dayOfWeek === 2 || dayOfWeek === 5 ? 'ladder' : 'percent';

  const plan: DayPlan = {
    id: date,
    date,
    dayIndex,
    targets,
    windows,
    model,
    tier,
  };

  await saveDayPlan(plan);
  return plan;
}

/** Returns the tier the user should be on today, persisting a promotion to
 * the profile when they've earned one. */
async function resolveTier(profile: Profile, date: string): Promise<Profile['tier']> {
  const current = profile.tier ?? 100;
  const startedAt = profile.tierStartedAt || '';
  if (!startedAt) {
    await saveProfile({ ...profile, tier: current, tierStartedAt: date });
    return current;
  }

  const records = await getAllDayRecords();
  const next = checkTierPromotion(current, startedAt, date, records);
  if (next !== current) {
    await saveProfile({ ...profile, tier: next, tierStartedAt: date });
  }
  return next;
}

const MISS_GRACE_MINUTES = 20;

/** Marks any pending window whose time has passed (with a grace period) as
 * missed, and persists the result. When `redistribute` is on, the missed
 * reps get spread into the remaining pending windows for the day; either way
 * the window stops showing as "up next" once its time has gone by. Only
 * meaningful for today's plan - a past day's unfinished windows should stay
 * as history, not get redistributed into a plan nobody will act on. */
export async function reflowMissedWindows(
  plan: DayPlan,
  todayIso: string,
  redistribute = true
): Promise<DayPlan> {
  if (plan.date !== todayIso) return plan;

  const nowMin = nowMinutes();
  let next = plan;
  let changed = false;

  for (const original of plan.windows) {
    const current = next.windows.find((w) => w.id === original.id);
    if (!current || current.status !== 'pending') continue;
    const minutesPast = nowMin - timeToMinutes(current.at);
    if (minutesPast > MISS_GRACE_MINUTES) {
      next = { ...next, windows: reflow(next.windows, current.id, redistribute) };
      changed = true;
    }
  }

  if (changed) await saveDayPlan(next);
  return next;
}

/** Recomputes today's DayRecord from banked sets against the plan's targets,
 * and rolls that into the streak. Call after every banked set. */
export async function recordDayProgress(plan: DayPlan): Promise<void> {
  const logs = await getSetLogs(plan.date);
  const completed: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
  for (const log of logs) completed[log.exercise] += log.reps;

  let totalTarget = 0;
  let totalCompleted = 0;
  const exercises: DayRecord['exercises'] = { push: { target: 0, completed: 0 }, pull: { target: 0, completed: 0 }, squat: { target: 0, completed: 0 } };
  for (const ex of EXERCISES) {
    const target = plan.targets[ex] ?? 0;
    exercises[ex] = { target, completed: completed[ex] };
    totalTarget += target;
    totalCompleted += Math.min(completed[ex], target);
  }

  // Round normally, but never let real activity round all the way down to an
  // empty-looking 0% on the heatmap (e.g. 2/500 reps rounds to 0 otherwise).
  const rawPct = totalTarget > 0 ? Math.round((100 * totalCompleted) / totalTarget) : 0;
  const totalVolumePct = totalCompleted > 0 ? Math.max(1, rawPct) : rawPct;
  const streakCredit = computeStreakCredit(totalTarget, totalCompleted);

  await saveDayRecord({ date: plan.date, exercises, totalVolumePct, streakCredit });

  const streak = await getStreak();
  await saveStreak(updateStreak(streak, plan.date, streakCredit));
}
