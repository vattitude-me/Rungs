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
}

/** Per-exercise tempo bounds and default, in seconds/rep. Pull-ups need a
 * slower floor than push/squat - 1.0s/rep is too fast to control a pull-up. */
export const TEMPO_RANGE: Record<Exercise, { min: number; max: number; default: number }> = {
  push: { min: 1, max: 4, default: 2.5 },
  pull: { min: 2, max: 5, default: 3 },
  squat: { min: 1, max: 4, default: 2 },
};

export const EXERCISE_LABELS: Record<Exercise, string> = {
  push: 'Push-ups',
  pull: 'Pull-ups',
  squat: 'Squats',
};

/** Per-exercise visual identity, shared across Today/Progress/Session so the
 * three exercises stay visually distinct everywhere using the same accent
 * ramp (push=accent, pull=accent-400, squat=accent-700). */
export const EXERCISE_ICON: Record<Exercise, string> = { push: '⌃', pull: '⌄', squat: '◍' };
export const EXERCISE_COLOR: Record<Exercise, string> = { push: '#9184d9', pull: '#b5abfc', squat: '#5d5294' };
export const EXERCISE_CHIP_BG: Record<Exercise, string> = { push: '#423a6a', pull: '#3f424d', squat: '#2b2741' };
export const EXERCISE_TINT_BG: Record<Exercise, string> = {
  push: 'rgba(145,132,217,.16)',
  pull: 'rgba(181,171,252,.16)',
  squat: 'rgba(93,82,148,.22)',
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
