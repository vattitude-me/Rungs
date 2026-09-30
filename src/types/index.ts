import type { ThemeId } from '../theme';

export type Exercise = 'push' | 'pull' | 'squat';

export type PullRung = 0 | 1 | 2 | 3 | 4; // rows, negatives, band, partials, full
export type BarAccess = 'doorway' | 'park' | 'none';
/** What the user rows with when they're on the Rows rung (or have no bar). */
export type RowEquipment = 'table' | 'dumbbell' | 'kettlebell' | 'band';
/** Daily total-rep tier. The goal ladder is 100 → 200 → 300 reps a day,
 * mixed across the three exercises, ending at 100 of each. */
export type Tier = 100 | 200 | 300;
export type CounterMode = 'voice' | 'tap';
export type CounterVariant = 'cadenceRing' | 'bigNumeral' | 'ladderLane';
export type DashboardVariant = 'rings' | 'fuelBars';
export type SetModel = 'ladder' | 'percent';
export type WindowStatus = 'pending' | 'done' | 'missed' | 'reflowed';

/** Kit the user has to hand. Nothing at all is the default - every slot has
 * a movement that needs no equipment - so this only ever widens the choice. */
export type Equipment = 'bar' | 'dumbbell' | 'band';

/** How the day's reps are laid out in time.
 * - spread: a few short windows at times the user picks (the original model)
 * - single: one session, sets and rests run back to back
 * - surprise: the same number of windows, at times drawn fresh each day */
export type DayStyle = 'spread' | 'single' | 'surprise';

/** Which part of the body gets the bigger share of the daily total. */
export type Focus = 'balanced' | 'upper' | 'lower';

/** The self-assessed starting point picked in onboarding, used to estimate
 * maxes until the user tests real ones. */
export type FitnessLevel = 'new' | 'returning' | 'active' | 'strong';

export type Units = 'metric' | 'imperial';

/** Sync bookkeeping carried by every row that backs up.
 *
 * `updatedAt` is the whole of the merge rule: when two devices hold the same
 * row, the one stamped later is the row. It's a plain device clock rather than
 * a server timestamp because rows are written offline, long before any server
 * sees them - and a set logged on a plane has to be comparable to one logged
 * at home. Phone clocks are network-synced to within seconds of each other,
 * and the only case where that margin matters is the same row edited on two
 * devices inside the same second, which is a person on two phones at once.
 *
 * `deletedAt` marks a row the user removed. Deletes have to be recorded rather
 * than done, because a row that merely vanished locally is indistinguishable
 * from one this device has never seen - and the next merge would helpfully
 * restore it. Carrying the delete as a stamped row means it merges by exactly
 * the same rule as an edit.
 */
export interface Synced {
  /** Optional at construction, always present once stored: every `save*` in
   * the db layer stamps it on the way in, so a caller building a fresh row
   * has nothing useful to say here and shouldn't have to invent a value. */
  updatedAt?: number;
  deletedAt?: number;
}

export interface Profile extends Synced {
  id: string;
  name: string;
  createdAt: number;
  maxes: Record<Exercise, number>;
  pullRung: PullRung;
  barAccess: BarAccess;
  rowEquipment?: RowEquipment;
  wake: string; // "06:30"
  sleep: string; // "23:00"
  windowCount: number;
  /** The window times the user actually chose during onboarding, e.g.
   * ["10:00","13:00","16:00","19:00"]. When set, these are used verbatim
   * instead of spacing windows evenly across the waking span. Optional so
   * profiles saved before this existed still load. */
  windowTimes?: string[];
  onboardingComplete: boolean;
  baselineComplete: boolean;
  lastRebaselineAt?: string; // ISO date
  /** IANA timezone, e.g. "Australia/Melbourne". Window times are local
   * wall-clock strings, so a server sending push has no way to know which
   * 09:00 is meant without this. Refreshed on every app open so it follows
   * the user if they travel or if their region's DST rules change. Optional
   * so profiles saved before push existed still load. */
  timeZone?: string;
  /** Current daily-total tier. Starts at 100, promotes to 200 then 300. */
  tier: Tier;
  /** Date the user reached the current tier, used to gate promotion. */
  tierStartedAt: string; // YYYY-MM-DD

  // Everything below arrived with movement choice and the fast onboarding.
  // All optional, so profiles written before it still load and sync; the
  // readers in data/movements.ts and engine/schedule.ts supply the defaults.

  /** The movement picked for each slot, by id from data/movements.ts. A
   * missing slot means "whatever suits my level and kit". */
  variations?: Partial<Record<Exercise, string>>;
  equipment?: Equipment[];
  dayStyle?: DayStyle;
  focus?: Focus;
  level?: FitnessLevel;
  /** True while `maxes` are the estimate from the level picker rather than
   * numbers the user tested or typed. Cleared by a retest. */
  maxesEstimated?: boolean;
  weightKg?: number;
  heightCm?: number;
  units?: Units;
  /** When the next-day check-in (name, body, real numbers) was answered. */
  checkInDoneAt?: string; // YYYY-MM-DD
  /** A "not now" on the check-in hides it for the rest of that day only. */
  checkInSnoozedOn?: string; // YYYY-MM-DD
}

export interface BaselineLog extends Synced {
  id: string;
  exercise: Exercise;
  maxReps: number;
  testedAt: number;
}

export interface WindowItem {
  exercise: Exercise;
  reps: number;
  ladder?: number[];
}

export interface Window {
  id: string;
  at: string; // "12:30"
  items: WindowItem[];
  status: WindowStatus;
}

export interface DayPlan extends Synced {
  id: string;
  date: string; // YYYY-MM-DD
  dayIndex: number;
  targets: Record<Exercise, number>;
  windows: Window[];
  model: SetModel;
  /** The daily total this plan was built for (sum of targets). */
  tier: Tier;
}

export interface SetLog extends Synced {
  id: string;
  date: string;
  at: string;
  exercise: Exercise;
  reps: number;
  targetReps: number;
  tempo: number;
  mode: CounterMode;
  windowId?: string;
  /** Movement id the set was done as (data/movements.ts). Absent on sets
   * logged before movement choice existed, which were the slot's classic. */
  variation?: string;
  source: 'session' | 'manual' | 'baseline';
  completedAt: number;
}

export interface StreakData extends Synced {
  id: string;
  current: number;
  longest: number;
  lastActiveDate: string;
  graceDaysUsedInWindow: number;
  windowStartDate: string;
}

export interface DayRecord extends Synced {
  date: string;
  exercises: Record<Exercise, { target: number; completed: number }>;
  totalVolumePct: number;
  streakCredit: boolean;
}

export interface AppSettings extends Synced {
  id: string;
  counterVariant: CounterVariant;
  dashboardVariant: DashboardVariant;
  voice: boolean;
  ticks: boolean;
  haptics: boolean;
  reminders: boolean; // stub, default off
  nudges: boolean; // stub, default off
  waitlistSquad: boolean;
  defaultTempo: number; // 1.00–4.00 step .25, default 2.00
  /** Colour theme. Synced like every other setting, so a phone and a laptop
   * agree; optional because settings saved before themes existed lack it. */
  theme?: ThemeId;
}

/** Per-exercise tempo bounds and default, in seconds/rep. Pull-ups need a
 * slower floor than push/squat - 1.0s/rep is too fast to control a pull-up. */
export const TEMPO_RANGE: Record<Exercise, { min: number; max: number; default: number }> = {
  push: { min: 1, max: 4, default: 2.5 },
  pull: { min: 2, max: 5, default: 3 },
  squat: { min: 1, max: 4, default: 2 },
};

/** The classic movement for each slot. Where the user's chosen movement is
 * known, show `movementFor(...)` from data/movements.ts instead. */
export const EXERCISE_LABELS: Record<Exercise, string> = {
  push: 'Push-ups',
  pull: 'Pull-ups',
  squat: 'Squats',
};

/** The slot itself - what a day is made of, whatever movement fills it. */
export const SLOT_LABELS: Record<Exercise, string> = {
  push: 'Push',
  pull: 'Pull',
  squat: 'Legs',
};

/** Per-exercise visual identity, shared across Today/Progress/Session so the
 * three exercises stay visually distinct everywhere. Each is a CSS variable
 * (index.css), normally three steps of the accent ramp, so they follow the
 * colour theme. */
export const EXERCISE_ICON: Record<Exercise, string> = { push: '⌃', pull: '⌄', squat: '◍' };
export const EXERCISE_COLOR: Record<Exercise, string> = {
  push: 'var(--color-ex-push)',
  pull: 'var(--color-ex-pull)',
  squat: 'var(--color-ex-squat)',
};
export const EXERCISE_CHIP_BG: Record<Exercise, string> = {
  push: 'var(--color-ex-push-chip)',
  pull: 'var(--color-ex-pull-chip)',
  squat: 'var(--color-ex-squat-chip)',
};
export const EXERCISE_TINT_BG: Record<Exercise, string> = {
  push: 'color-mix(in srgb, var(--color-ex-push) 16%, transparent)',
  pull: 'color-mix(in srgb, var(--color-ex-pull) 16%, transparent)',
  squat: 'color-mix(in srgb, var(--color-ex-squat) 22%, transparent)',
};

export const PULL_RUNG_LABELS: Record<PullRung, string> = {
  0: 'Rows',
  1: 'Negatives',
  2: 'Band',
  3: 'Partials',
  4: 'Full',
};

/** What each rung actually asks of you, shown when picking a starting rung. */
export const PULL_RUNG_HINTS: Record<PullRung, string> = {
  0: "Can't hang yet, pull your bodyweight or a weight horizontally",
  1: 'Jump to the top, lower yourself as slowly as you can',
  2: 'A band under your feet takes some of the weight',
  3: 'Half a rep from a dead hang, working toward the full range',
  4: 'Chin over the bar from a dead hang, no help',
};

export const ROW_EQUIPMENT_LABELS: Record<RowEquipment, string> = {
  table: 'Under a table or desk',
  dumbbell: 'Dumbbell rows',
  kettlebell: 'Kettlebell rows',
  band: 'Resistance band rows',
};

export const TIERS: Tier[] = [100, 200, 300];
