import type { DayStyle, Profile } from '../types';

/** When in the day the reps happen, for each day style.
 *
 * Pure on purpose: the plan generator, the reminder scheduler and the push
 * worker (worker/index.js mirrors this) all have to agree on a day's times
 * without talking to each other, and a surprise day in particular must come
 * out the same on every device and on the server. */

export const DAY_STYLES: { id: DayStyle; title: string; sub: string }[] = [
  { id: 'spread', title: 'Little and often', sub: 'A few short sets spread through the day' },
  { id: 'single', title: 'One session', sub: 'Everything in one go, about 15 minutes' },
  { id: 'surprise', title: 'Surprise me', sub: 'Sets land at random times. Be ready.' },
];

/** One-session times offered in onboarding and Settings. */
export const SINGLE_TIMES: { at: string; label: string }[] = [
  { at: '07:30', label: 'Morning' },
  { at: '12:30', label: 'Lunch' },
  { at: '18:30', label: 'Evening' },
];

export const DEFAULT_SPREAD_COUNT = 3;
export const MIN_WINDOWS = 2;
export const MAX_WINDOWS = 6;

/** Surprise windows land inside this span, local time. Narrower than waking
 * hours on purpose: a random 6:40am set is a surprise nobody wants. */
const SURPRISE_START = 9 * 60;
const SURPRISE_END = 20 * 60 + 30;
/** Never closer together than this, so two can't land back to back. */
const SURPRISE_MIN_GAP = 75;

export function dayStyleOf(profile: Pick<Profile, 'dayStyle'>): DayStyle {
  return profile.dayStyle ?? 'spread';
}

function toTime(mins: number): string {
  const m = ((Math.round(mins) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Spreads `count` windows evenly between 09:00 and 19:00. */
export function evenTimes(count: number): string[] {
  const start = 9 * 60;
  const end = 19 * 60;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => toTime(start + step * i));
}

/** Small deterministic PRNG (mulberry32), seeded from the date string. */
function seeded(seed: string): () => number {
  let h = 1779033703;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A surprise day's times: `count` slots, each drawn inside its own equal
 * slice of the span so they can't bunch up, then nudged apart if two
 * neighbours still land too close. Rounded to five minutes so they read like
 * times a person would pick. */
export function surpriseTimes(date: string, count: number): string[] {
  const rand = seeded(`rungs-${date}`);
  const slice = (SURPRISE_END - SURPRISE_START) / count;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const lo = SURPRISE_START + slice * i;
    let t = Math.round((lo + rand() * slice * 0.8) / 5) * 5;
    if (out.length && t - out[out.length - 1] < SURPRISE_MIN_GAP) {
      t = out[out.length - 1] + SURPRISE_MIN_GAP;
    }
    out.push(Math.min(t, SURPRISE_END));
  }
  return out.map(toTime);
}

/** The window times for a given day under this profile's style. */
/** Evenly spaced across the waking span - how profiles with no saved times
 * have always been scheduled. Same formula as the worker's evenTimes. */
function wakingTimes(count: number, wake: string, sleep: string): string[] {
  const [wh, wm] = wake.split(':').map(Number);
  const [sh, sm] = sleep.split(':').map(Number);
  const start = wh * 60 + wm;
  const span = Math.max(0, sh * 60 + sm - start);
  return Array.from({ length: count }, (_, i) => toTime(start + Math.round((span * (i + 1)) / (count + 1))));
}

export function timesForDate(
  profile: Pick<Profile, 'dayStyle' | 'windowTimes' | 'windowCount' | 'wake' | 'sleep'>,
  date: string
): string[] {
  const style = dayStyleOf(profile);
  const saved = profile.windowTimes?.length ? [...profile.windowTimes].sort() : null;
  if (style === 'single') return [saved?.[0] ?? SINGLE_TIMES[2].at];
  if (style === 'surprise') {
    const count = Math.min(MAX_WINDOWS, Math.max(MIN_WINDOWS, profile.windowCount || DEFAULT_SPREAD_COUNT));
    return surpriseTimes(date, count);
  }
  return saved ?? wakingTimes(profile.windowCount || 4, profile.wake || '06:30', profile.sleep || '23:00');
}
