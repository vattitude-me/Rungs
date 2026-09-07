import type { Exercise, DayPlan, Profile, DayRecord } from '../types';
import {
  computeWindowCount, splitIntoWindows, splitIntoSets, reflow,
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
  const windows = splitIntoWindows(targets, windowCount, profile.wake, profile.sleep, profile.windowTimes)
    .map((w) => ({ ...w, items: splitIntoSets(w.items, profile.maxes) }));

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
 * missed, and persists the result. The missed reps get spread into the
 * remaining open windows for the day, and the window stops showing as "up
 * next" once its time has gone by. Only meaningful for today's plan - a past
 * day's unfinished windows should stay as history, not get redistributed
 * into a plan nobody will act on. */
export async function reflowMissedWindows(
  plan: DayPlan,
  todayIso: string,
  maxes?: Record<Exercise, number>
): Promise<DayPlan> {
  if (plan.date !== todayIso) return plan;

  const nowMin = nowMinutes();
  let next = plan;
  let changed = false;

  for (const original of plan.windows) {
    const current = next.windows.find((w) => w.id === original.id);
    // 'reflowed' means still open, just topped up by an earlier miss - it's
    // as eligible to go stale as 'pending' is, or a boosted window that's
    // since gone unactioned would surface as "up next" forever.
    if (!current || (current.status !== 'pending' && current.status !== 'reflowed')) continue;
    const minutesPast = nowMin - timeToMinutes(current.at);
    if (minutesPast > MISS_GRACE_MINUTES) {
      next = { ...next, windows: reflow(next.windows, current.id) };
      changed = true;
    }
  }

  // Absorbing a miss can push an item past what's reasonable in one set, so
  // re-split the windows that grew.
  if (changed && maxes) {
    next = {
      ...next,
      windows: next.windows.map((w) =>
        w.status === 'reflowed' ? { ...w, items: splitIntoSets(w.items, maxes) } : w
      ),
    };
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

/** Rebuilds today's remaining windows after the user changes their schedule.
 *
 * Windows already done or missed are kept exactly as they are - they're
 * history, and their reps are already banked. Only what's still outstanding
 * gets re-cut across the new times, so changing the schedule at noon can't
 * erase the morning's work or double-count it. */
export async function rebuildTodayWindows(
  plan: DayPlan,
  profile: Profile,
  windowTimes: string[]
): Promise<DayPlan> {
  const settled = plan.windows.filter((w) => w.status === 'done' || w.status === 'missed');
  const bankedByExercise: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
  for (const w of settled) {
    for (const item of w.items) bankedByExercise[item.exercise] += item.reps;
  }

  const remainingTargets: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
  for (const ex of EXERCISES) {
    remainingTargets[ex] = Math.max(0, (plan.targets[ex] ?? 0) - bankedByExercise[ex]);
  }

  // Only schedule into times that haven't already gone by, so a new window
  // isn't born already missed.
  const nowMin = nowMinutes();
  const futureTimes = windowTimes.filter((t) => timeToMinutes(t) > nowMin);
  const times = futureTimes.length > 0 ? futureTimes : windowTimes.slice(-1);

  const rebuilt = splitIntoWindows(
    remainingTargets, times.length, profile.wake, profile.sleep, times
  ).map((w, i) => ({
    ...w,
    id: `r${Date.now()}-${i}`,
    items: splitIntoSets(w.items, profile.maxes),
  }));

  const next: DayPlan = {
    ...plan,
    windows: [...settled, ...rebuilt].sort((a, b) => a.at.localeCompare(b.at)),
  };
  await saveDayPlan(next);
  return next;
}
