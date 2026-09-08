import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { computeTierTargets, splitIntoWindows } from './coach';
import { parseLocalDate, addDays } from './dates';
import type { DayPlan, Profile, Window } from '../types';
import { EXERCISE_LABELS } from '../types';

const CHANNEL_ID = 'windows';
const LEAD_MINUTES = 5;

/** Days beyond today handed to the OS up front. Scheduling only ever happens
 * while the app is open, so without a look-ahead a day the user never opens
 * the app gets no reminders at all - exactly the day a nudge matters most. */
const LOOK_AHEAD_DAYS = 7;

/** Slots swept when clearing a day. Comfortably above any real window count,
 * so a day that shrank still has its leftovers cancelled. */
const MAX_SLOTS_PER_DAY = 12;

/** iOS keeps only the 64 soonest pending local notifications per app and
 * silently drops the rest, so stay under that with room to spare. */
const MAX_PENDING = 60;

/** Notification ids are derived from the day and the window's slot, so
 * re-scheduling replaces rather than duplicates. Kept well inside Android's
 * 32-bit id range. */
function notificationId(date: string, key: string): number {
  const full = `${date}-${key}`;
  let hash = 0;
  for (let i = 0; i < full.length; i++) {
    hash = (hash * 31 + full.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_000_000;
}

function bodyFor(w: Window): string {
  return w.items
    .map((it) => `${it.reps} ${EXERCISE_LABELS[it.exercise].toLowerCase()}`)
    .join(' + ') || 'Time for a set';
}

/** The windows a future day would be built with.
 *
 * Deliberately pure: it does NOT call generateDayPlan, which persists the plan
 * and can advance the tier. Generating a future day would both cache a plan
 * built from today's tier (getDayPlan returns it unchanged when that day
 * arrives) and stamp tierStartedAt with a future date. These projections are
 * only ever used for reminder text - the real plan replaces them the moment
 * the user opens the app that day. */
function projectedWindows(profile: Profile): Window[] {
  const targets = computeTierTargets(profile.maxes, profile.tier ?? 100);
  const count = profile.windowTimes?.length || profile.windowCount || 4;
  return splitIntoWindows(targets, count, profile.wake, profile.sleep, profile.windowTimes);
}

/** Every date this module schedules into, today first. */
function scheduledDates(from: string): string[] {
  const dates = [from];
  for (let i = 1; i <= LOOK_AHEAD_DAYS; i++) dates.push(addDays(from, i));
  return dates;
}

/** Clears every id this module could have used across the scheduled range -
 * both the current slot ids and the window-id scheme used before the
 * look-ahead existed, so upgrades don't strand old notifications. */
async function clearScheduled(plan: DayPlan): Promise<void> {
  const ids: { id: number }[] = [];
  for (const date of scheduledDates(plan.date)) {
    for (let slot = 0; slot < MAX_SLOTS_PER_DAY; slot++) {
      ids.push({ id: notificationId(date, `slot-${slot}`) });
    }
  }
  for (const w of plan.windows) ids.push({ id: notificationId(plan.date, w.id) });

  try {
    await LocalNotifications.cancel({ notifications: ids });
  } catch {
    // Nothing scheduled yet.
  }
}

export function isNative(): boolean {
  return Capacitor.isNativePlatform();
}

/**
 * Asks for notification permission. On Android 13+ this shows the system
 * POST_NOTIFICATIONS dialog; on web it falls back to the Notification API.
 * Returns whether permission ended up granted.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (isNative()) {
    const result = await LocalNotifications.requestPermissions();
    if (result.display !== 'granted') return false;
    // A channel is required for notifications to appear at all on Android 8+.
    try {
      await LocalNotifications.createChannel({
        id: CHANNEL_ID,
        name: 'Window reminders',
        description: 'A nudge a few minutes before each rep window',
        importance: 4,
        visibility: 1,
      });
    } catch {
      // createChannel is Android-only; harmless elsewhere.
    }
    return true;
  }

  if (!('Notification' in window)) return false;
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

export async function hasNotificationPermission(): Promise<boolean> {
  if (isNative()) {
    const result = await LocalNotifications.checkPermissions();
    return result.display === 'granted';
  }
  return 'Notification' in window && Notification.permission === 'granted';
}

/**
 * Schedules a real OS notification ~5 minutes before each upcoming window,
 * for today and the next week.
 *
 * This is the important difference from the web path: these fire even when the
 * app is closed, which is the whole point of a reminder. Today comes from the
 * real plan; later days are projected from the profile so the user still gets
 * nudged on a day they never open the app. Every call clears the whole range
 * first, so edited window times and completed windows don't leave stale
 * notifications behind.
 */
export async function scheduleWindowReminders(plan: DayPlan, profile: Profile): Promise<void> {
  if (!isNative()) return;
  if (!(await hasNotificationPermission())) return;

  await clearScheduled(plan);

  const now = Date.now();
  const pending: {
    id: number; title: string; body: string;
    schedule: { at: Date }; channelId: string;
  }[] = [];

  for (const date of scheduledDates(plan.date)) {
    // Index against the unfiltered list so a window's id stays stable as the
    // day's earlier windows get completed and drop out.
    const windows = date === plan.date
      ? plan.windows.map((w, slot) => ({ w, slot }))
        .filter(({ w }) => w.status === 'pending' || w.status === 'reflowed')
      : projectedWindows(profile).map((w, slot) => ({ w, slot }));

    for (const { w, slot } of windows) {
      const [h, m] = w.at.split(':').map(Number);
      const at = parseLocalDate(date);
      at.setHours(h, m - LEAD_MINUTES, 0, 0);
      if (at.getTime() <= now) continue;

      pending.push({
        id: notificationId(date, `slot-${slot}`),
        title: `Window at ${w.at}`,
        body: bodyFor(w),
        schedule: { at },
        channelId: CHANNEL_ID,
      });
    }
  }

  if (pending.length === 0) return;
  const notifications = pending
    .sort((a, b) => a.schedule.at.getTime() - b.schedule.at.getTime())
    .slice(0, MAX_PENDING);

  try {
    await LocalNotifications.schedule({ notifications });
  } catch {
    // Scheduling can fail if permission was revoked between checks.
  }
}

/** Cancels every reminder across the scheduled range - used when the user
 * turns reminders off. */
export async function cancelWindowReminders(plan: DayPlan): Promise<void> {
  if (!isNative()) return;
  await clearScheduled(plan);
}

/** Friend nudges get their own Android channel, so they can be silenced
 * without losing window reminders. Someone who wants training prompts but not
 * social ones should be able to say so with the OS's own controls rather than
 * by turning the feature off. */
const SQUAD_CHANNEL_ID = 'squad';

/** Notification ids for nudges, drawn from a range the window scheduler
 * doesn't use so the two can never collide and cancel each other. */
function nudgeNotificationId(key: string): number {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return 2_000_000 + (Math.abs(hash) % 1_000_000);
}

export interface FriendNudge {
  id: string;
  title: string;
  body: string;
}

/** Shows friend nudges that arrived while the app is open.
 *
 * Native only. On the web the push worker delivers these, and raising them
 * here as well would show every nudge twice.
 *
 * Fired immediately rather than scheduled: the nudge has already happened, and
 * the notification is how the user finds out. Silent on failure - a missed
 * nudge notification is a small thing, and the item is still in Squad.
 */
export async function showFriendNudges(nudges: FriendNudge[]): Promise<void> {
  if (!isNative() || nudges.length === 0) return;
  if (!(await hasNotificationPermission())) return;

  try {
    await LocalNotifications.createChannel({
      id: SQUAD_CHANNEL_ID,
      name: 'Squad',
      description: 'Nudges and friend requests from people you train with',
      importance: 4,
      visibility: 1,
    });
  } catch {
    // Android-only; harmless elsewhere.
  }

  try {
    await LocalNotifications.schedule({
      notifications: nudges.map((n) => ({
        id: nudgeNotificationId(n.id),
        title: n.title,
        body: n.body,
        channelId: SQUAD_CHANNEL_ID,
        extra: { url: '/squad' },
      })),
    });
  } catch {
    // Permission revoked between the check and the schedule, or the OS
    // refused. Squad still shows the nudge.
  }
}
