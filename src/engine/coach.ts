import type { Exercise, Window, WindowItem, PullRung, SetModel, StreakData, Tier, DayRecord } from '../types';
import { daysBetweenDates } from './dates';

const EXERCISES: Exercise[] = ['push', 'pull', 'squat'];

// ---------------------------------------------------------------------------
// Tier model
//
// The goal is a daily TOTAL: 100 reps a day mixed across the three exercises,
// then 200, then 300 - at which point it's 100 of each and you're done. Each
// exercise's share of the tier is weighted by your relative strength at it, so
// someone who can't do a pull-up gets few pull-ups and more squats, and the
// mix evens out toward 100/100/100 as the tiers climb.
// ---------------------------------------------------------------------------

/** Every exercise carries at least this share of the daily total, so no
 * exercise ever drops out of the plan entirely - even a zero pull-up max. */
const MIN_SHARE = 0.08;

/** Relative difficulty used only when every max is 0 (a true first-day
 * beginner with no signal to weight by): squats are the easiest bodyweight
 * movement to start from, pull-ups the hardest, so the day leans that way
 * instead of splitting three ways evenly. */
const NO_SIGNAL_WEIGHTS: Record<Exercise, number> = { push: 1.2, pull: 0.6, squat: 2 };

/** Per-exercise share weights, from each max relative to the total. Blended
 * toward an even 1/3 split as the tier climbs, since tier 300 is by
 * definition an even 100/100/100. */
export function computeShares(
  maxes: Record<Exercise, number>,
  tier: Tier
): Record<Exercise, number> {
  const rawMaxes = EXERCISES.map((ex) => Math.max(0, maxes[ex] ?? 0));
  const hasSignal = rawMaxes.some((m) => m > 0);
  // With no real numbers to weight by, fall back to relative difficulty
  // rather than treating "0/0/0" the same as "any three equal maxes."
  const weights = hasSignal
    ? rawMaxes
    : EXERCISES.map((ex) => NO_SIGNAL_WEIGHTS[ex]);
  const totalWeight = weights.reduce((a, b) => a + b, 0);

  // 0 at tier 100 (fully strength-weighted) → 1 at tier 300 (fully even).
  const evenness = (tier - 100) / 200;
  const even = 1 / 3;

  const raw: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };
  EXERCISES.forEach((ex, i) => {
    const weighted = weights[i] / totalWeight;
    raw[ex] = Math.max(MIN_SHARE, weighted * (1 - evenness) + even * evenness);
  });

  const sum = EXERCISES.reduce((a, ex) => a + raw[ex], 0);
  for (const ex of EXERCISES) raw[ex] = raw[ex] / sum;
  return raw;
}

/** No single exercise ever exceeds 100 a day - that's the end goal, not a
 * waypoint. Overflow from a lopsided split goes to the other two. */
const PER_EXERCISE_CAP = 100;

/** Splits a tier's daily total into per-exercise targets, weighted by relative
 * strength. Rounds so the parts always sum to exactly the tier total. */
export function computeTierTargets(
  maxes: Record<Exercise, number>,
  tier: Tier
): Record<Exercise, number> {
  const shares = computeShares(maxes, tier);
  const targets: Record<Exercise, number> = { push: 0, pull: 0, squat: 0 };

  let assigned = 0;
  // Assign all but the last from the share, then give the remainder to the
  // last one so rounding never leaves the total off by a rep or two.
  EXERCISES.forEach((ex, i) => {
    if (i === EXERCISES.length - 1) {
      targets[ex] = tier - assigned;
    } else {
      targets[ex] = Math.max(1, Math.round(tier * shares[ex]));
      assigned += targets[ex];
    }
  });

  // Push anything above the cap onto whichever exercises still have headroom,
  // so a very lopsided profile doesn't get asked for 108 pull-ups at tier 200.
  let overflow = 0;
  for (const ex of EXERCISES) {
    if (targets[ex] > PER_EXERCISE_CAP) {
      overflow += targets[ex] - PER_EXERCISE_CAP;
      targets[ex] = PER_EXERCISE_CAP;
    }
  }
  while (overflow > 0) {
    const room = EXERCISES.filter((ex) => targets[ex] < PER_EXERCISE_CAP);
    if (room.length === 0) break;
    const each = Math.max(1, Math.floor(overflow / room.length));
    for (const ex of room) {
      if (overflow === 0) break;
      const add = Math.min(each, overflow, PER_EXERCISE_CAP - targets[ex]);
      targets[ex] += add;
      overflow -= add;
    }
  }

  return targets;
}

/** Days at a tier before promotion is even considered. */
const TIER_MIN_DAYS = 14;
/** Of the last N days, how many must have earned credit to promote. */
const TIER_LOOKBACK_DAYS = 10;
const TIER_PROMOTE_HITS = 7;

/** Promotes 100 → 200 → 300 once the user has held the current tier for at
 * least two weeks AND credited most of the last ten days. Returns the tier
 * they should be on now. */
export function checkTierPromotion(
  tier: Tier,
  tierStartedAt: string,
  today: string,
  recentRecords: DayRecord[]
): Tier {
  if (tier >= 300) return tier;
  if (!tierStartedAt) return tier;
  if (daysBetweenDates(tierStartedAt, today) < TIER_MIN_DAYS) return tier;

  const recent = recentRecords
    .filter((r) => r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, TIER_LOOKBACK_DAYS);

  if (recent.length < TIER_LOOKBACK_DAYS) return tier;
  const hits = recent.filter((r) => r.streakCredit).length;
  if (hits < TIER_PROMOTE_HITS) return tier;

  return (tier === 100 ? 200 : 300) as Tier;
}

export function computeWindowCount(wakingSpanHours: number, dailyVolume: number): 3 | 4 | 5 {
  if (wakingSpanHours < 12) return 3;
  if (dailyVolume > 70) return 5;
  return 4;
}

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function minutesToTime(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

/** Which exercises land in window `i` (1-based), cycling through the list so
 * consecutive windows lead with different movements. */
function pickExercises(order: Exercise[], i: number, perWindow: number): Exercise[] {
  const startIdx = ((i - 1) * perWindow) % Math.max(1, order.length);
  const picks: Exercise[] = [];
  for (let k = 0; k < order.length && picks.length < perWindow; k++) {
    const ex = order[(startIdx + k) % order.length];
    if (!picks.includes(ex)) picks.push(ex);
  }
  return picks;
}

/** Splits daily per-exercise targets across windows, keeping each window to a
 * couple of exercises where there are enough windows to go round. With only
 * two or three windows every exercise has to appear in each one, or the day
 * back-loads badly onto the last window.
 *
 * `times` are the window times the user picked during onboarding and are used
 * verbatim. Without them, times are derived by spacing `windowCount` windows
 * evenly across the waking span, avoiding the first 30min after waking and the
 * last 60min before sleep. */
export function splitIntoWindows(
  dailyTargets: Record<Exercise, number>,
  windowCount: number,
  wake: string,
  sleep: string,
  times?: string[]
): Window[] {
  const wakeMin = timeToMinutes(wake);
  let sleepMin = timeToMinutes(sleep);
  if (sleepMin <= wakeMin) sleepMin += 24 * 60;

  const usableStart = wakeMin + 30;
  const usableEnd = sleepMin - 60;
  const span = Math.max(usableEnd - usableStart, windowCount * 10);
  const gap = span / (windowCount + 1);

  // Chosen times win over the computed spacing, but only where one exists -
  // a shorter list (or none) falls back per-window rather than dropping any.
  const explicit = times?.length ? [...times].sort((a, b) => a.localeCompare(b)) : null;
  const timeFor = (i: number) =>
    explicit?.[i - 1] ?? minutesToTime(Math.round(usableStart + gap * i));

  const windows: Window[] = [];
  const remaining: Record<Exercise, number> = { ...dailyTargets };
  const exerciseOrder = EXERCISES.filter((e) => dailyTargets[e] > 0);

  // Precompute, per exercise, which window indices (1-based) it lands in -
  // the picks loop below is deterministic from i alone, so this mirrors it
  // rather than re-deriving picks twice.
  // Cycling two exercises per window keeps each one short, but that only
  // works when there are enough windows for every exercise to come round
  // often enough. Below that, spread all of them across every window.
  const perWindow = windowCount >= exerciseOrder.length * 2 ? 2 : exerciseOrder.length;

  const appearances: Record<Exercise, number[]> = { push: [], pull: [], squat: [] };
  for (let i = 1; i <= windowCount; i++) {
    for (const ex of pickExercises(exerciseOrder, i, perWindow)) appearances[ex].push(i);
  }
  const lastAppearance: Partial<Record<Exercise, number>> = {};
  for (const ex of exerciseOrder) {
    const list = appearances[ex];
    if (list.length > 0) lastAppearance[ex] = list[list.length - 1];
  }

  for (let i = 1; i <= windowCount; i++) {
    const windowsLeft = windowCount - i + 1;
    const at = timeFor(i);
    const items: WindowItem[] = [];

    const picks = pickExercises(exerciseOrder, i, perWindow).filter((ex) => remaining[ex] > 0);

    for (const ex of picks) {
      // On this exercise's last scheduled window, take everything left -
      // windowsLeft counts windows in general, not windows that still
      // include this exercise, so relying on it here would strand reps.
      const reps = lastAppearance[ex] === i
        ? remaining[ex]
        : Math.max(0, Math.ceil(remaining[ex] / windowsLeft));
      if (reps > 0) {
        items.push({ exercise: ex, reps });
        remaining[ex] -= reps;
      }
    }

    windows.push({ id: `w${i}`, at, items, status: 'pending' });
  }

  return windows;
}

const REFLOW_CAP = 0.4;

/** Marks a missed window as such and spreads its reps across the remaining
 * open windows, capped at +40% of any window's original volume so a blown-off
 * morning can't turn the last window of the day into an impossible pile;
 * overflow past that is dropped. */
export function reflow(windows: Window[], missedWindowId: string): Window[] {
  const missed = windows.find((w) => w.id === missedWindowId);
  if (!missed) return windows;

  const missedByExercise: Partial<Record<Exercise, number>> = {};
  for (const item of missed.items) {
    missedByExercise[item.exercise] = (missedByExercise[item.exercise] ?? 0) + item.reps;
  }

  // 'reflowed' windows are still open (just already topped up once), so a
  // later miss can still add to them.
  const isOpen = (w: Window) => w.status === 'pending' || w.status === 'reflowed';
  const pending = windows.filter((w) => w.id !== missedWindowId && isOpen(w));
  if (pending.length === 0) {
    return windows.map((w) => (w.id === missedWindowId ? { ...w, status: 'missed' } : w));
  }

  return windows.map((w) => {
    if (w.id === missedWindowId) return { ...w, status: 'missed' };
    if (!isOpen(w)) return w;

    const items = w.items.map((item) => {
      const extra = missedByExercise[item.exercise];
      if (!extra) return item;
      const share = Math.floor(extra / pending.length);
      const cap = Math.floor(item.reps * REFLOW_CAP);
      const added = Math.min(share, cap);
      return { ...item, reps: item.reps + added };
    });
    return { ...w, items, status: 'reflowed' };
  });
}

/** Fraction of a tested max we'll ask for in one unbroken set. Below a true
 * max effort, so a set is hard but finishable - going to failure every set
 * wrecks the rest of the day's windows. */
const SET_MAX_FRACTION = 0.8;

/** Ceilings for when there's no tested max to scale from (a 0/0/0 baseline),
 * and as an upper bound for a very strong max - 60 unbroken squats is a
 * grind whatever your max is. */
const SET_CEILING: Record<Exercise, number> = { push: 20, pull: 8, squat: 25 };

/** Largest single set we'll ask of someone for one exercise: 80% of their
 * tested max, held within a sane ceiling and at least 5 so the day never
 * fragments into a dozen trivial sets. */
export function setCapFor(exercise: Exercise, max: number): number {
  const fromMax = Math.floor(Math.max(0, max) * SET_MAX_FRACTION);
  const capped = Math.min(fromMax || SET_CEILING[exercise], SET_CEILING[exercise]);
  return Math.max(5, capped);
}

/** Breaks a window's items into sets no larger than the user can reasonably
 * do unbroken, splitting evenly so 40 squats reads as 20 + 20 rather than
 * 25 + 15. Items already within the cap are left exactly as they are. */
export function splitIntoSets(
  items: WindowItem[],
  maxes: Record<Exercise, number>
): WindowItem[] {
  const out: WindowItem[] = [];
  for (const item of items) {
    const cap = setCapFor(item.exercise, maxes[item.exercise] ?? 0);
    if (item.reps <= cap) {
      out.push(item);
      continue;
    }
    const setCount = Math.ceil(item.reps / cap);
    const base = Math.floor(item.reps / setCount);
    // Spread the remainder over the earliest sets, so any heavier set comes
    // while the user is freshest.
    const remainder = item.reps % setCount;
    for (let i = 0; i < setCount; i++) {
      out.push({ ...item, reps: base + (i < remainder ? 1 : 0) });
    }
  }
  return out;
}

export interface SetStructure {
  model: SetModel;
  sets: number[];
}

/** Ladder days (Tue=2/Fri=5) run a pyramid up to the window volume; other
 * days repeat round(max*0.55) reps per set until the volume is met. */
export function buildSetStructure(
  windowVolume: number,
  currentMax: number,
  dayOfWeek: number
): SetStructure {
  const isLadderDay = dayOfWeek === 2 || dayOfWeek === 5;

  if (isLadderDay) {
    const ladder = [1, 2, 3, 4, 3, 2, 1];
    let total = ladder.reduce((a, b) => a + b, 0);
    const scale = windowVolume / total;
    const sets = ladder.map((n) => Math.max(1, Math.round(n * scale)));
    return { model: 'ladder', sets };
  }

  const perSet = Math.max(1, Math.round(currentMax * 0.55));
  const sets: number[] = [];
  let remaining = windowVolume;
  while (remaining > 0) {
    const reps = Math.min(perSet, remaining);
    sets.push(reps);
    remaining -= reps;
  }
  return { model: 'percent', sets };
}

const REBASELINE_INTERVAL_DAYS = 21;

export function shouldRebaseline(lastRebaselineAt: string | undefined, today: string): boolean {
  if (!lastRebaselineAt) return false;
  return daysBetweenDates(lastRebaselineAt, today) >= REBASELINE_INTERVAL_DAYS;
}

export interface RebaselineResult {
  maxes: Record<Exercise, number>;
  deload: boolean;
}

export function applyRebaseline(
  previousMaxes: Record<Exercise, number>,
  newMaxes: Record<Exercise, number>
): RebaselineResult {
  const deload = EXERCISES.some((ex) => newMaxes[ex] < previousMaxes[ex]);
  return { maxes: newMaxes, deload };
}

const PULLUP_PROMOTION_REPS = 8;
const PULLUP_DEMOTION_PCT = 0.4;

export function checkPullupPromotion(rung: PullRung, setReps: number): PullRung {
  if (rung < 4 && setReps >= PULLUP_PROMOTION_REPS) return (rung + 1) as PullRung;
  return rung;
}

export function checkPullupDemotion(rung: PullRung, recentWindowPcts: number[]): PullRung {
  if (rung > 0 && recentWindowPcts.length >= 2) {
    const lastTwo = recentWindowPcts.slice(-2);
    if (lastTwo.every((pct) => pct < PULLUP_DEMOTION_PCT)) {
      return (rung - 1) as PullRung;
    }
  }
  return rung;
}

/** Any logged activity keeps the streak alive - there's no minimum share of
 * the day's full target required. */
export function computeStreakCredit(totalTarget: number, totalCompleted: number): boolean {
  return totalTarget > 0 && totalCompleted > 0;
}

const GRACE_WINDOW_DAYS = 14;
const GRACE_DAYS_ALLOWED = 1;

const daysBetween = daysBetweenDates;

/** Recomputes streak state given today's credit status. Consecutive credited
 * days extend the streak; a single missed day within a rolling 14-day window
 * is forgiven once (grace day) before the streak resets. */
export function updateStreak(streak: StreakData, today: string, creditedToday: boolean): StreakData {
  if (!creditedToday) {
    if (!streak.lastActiveDate) return streak;

    const windowStart = streak.windowStartDate || streak.lastActiveDate;
    const withinGraceWindow = daysBetween(windowStart, today) <= GRACE_WINDOW_DAYS;
    const graceAvailable = withinGraceWindow && streak.graceDaysUsedInWindow < GRACE_DAYS_ALLOWED;

    if (graceAvailable) {
      return { ...streak, graceDaysUsedInWindow: streak.graceDaysUsedInWindow + 1 };
    }
    return { ...streak, current: 0, lastActiveDate: '', graceDaysUsedInWindow: 0, windowStartDate: '' };
  }

  if (streak.lastActiveDate === today) return streak;

  // updateStreak only ever runs on days the user actually logs reps - there's
  // no background job to mark a fully-skipped day as missed. So a gap here
  // (days since last active) is the only place multi-day absences are ever
  // seen, and a gap of exactly 2 is what "one missed day" looks like. Larger
  // gaps must reset regardless of grace - otherwise a week-long absence would
  // be forgiven for free just because no grace day had been spent yet.
  const gap = streak.lastActiveDate ? daysBetween(streak.lastActiveDate, today) : Infinity;
  const windowStart = streak.windowStartDate || streak.lastActiveDate;
  const withinGraceWindow = Boolean(windowStart) && daysBetween(windowStart, today) <= GRACE_WINDOW_DAYS;
  const graceAvailable = withinGraceWindow && streak.graceDaysUsedInWindow < GRACE_DAYS_ALLOWED;
  const continued = gap === 1 || (gap === 2 && graceAvailable);
  const usedGrace = gap === 2 && continued;

  const current = continued ? streak.current + 1 : 1;
  const windowStartDate = continued ? (streak.windowStartDate || today) : today;
  const resetGraceWindow = !continued || daysBetween(windowStartDate, today) > GRACE_WINDOW_DAYS;

  return {
    ...streak,
    current,
    longest: Math.max(streak.longest, current),
    lastActiveDate: today,
    graceDaysUsedInWindow: resetGraceWindow ? 0 : streak.graceDaysUsedInWindow + (usedGrace ? 1 : 0),
    windowStartDate: resetGraceWindow ? today : windowStartDate,
  };
}
