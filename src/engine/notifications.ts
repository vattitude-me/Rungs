import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { parseLocalDate } from './dates';
import type { DayPlan } from '../types';
import { EXERCISE_LABELS } from '../types';

const CHANNEL_ID = 'windows';
const LEAD_MINUTES = 5;

/** Notification ids are derived from the window so re-scheduling replaces
 * rather than duplicates. Kept well inside Android's 32-bit id range. */
function notificationId(date: string, windowId: string): number {
  const key = `${date}-${windowId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 2_000_000;
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
 * Schedules a real OS notification ~5 minutes before each pending window.
 *
 * This is the important difference from the web path: these fire even when the
 * app is closed, which is the whole point of a reminder. Already-past windows
 * are skipped, and every call clears the day's previous schedule first so
 * edited window times don't leave stale notifications behind.
 */
export async function scheduleWindowReminders(plan: DayPlan): Promise<void> {
  if (!isNative()) return;
  if (!(await hasNotificationPermission())) return;

  const ids = plan.windows.map((w) => ({ id: notificationId(plan.date, w.id) }));
  try {
    await LocalNotifications.cancel({ notifications: ids });
  } catch {
    // Nothing scheduled yet.
  }

  const now = Date.now();
  const notifications = plan.windows
    .filter((w) => w.status === 'pending' || w.status === 'reflowed')
    .map((w) => {
      const [h, m] = w.at.split(':').map(Number);
      const at = parseLocalDate(plan.date);
      at.setHours(h, m - LEAD_MINUTES, 0, 0);
      return { window: w, at };
    })
    .filter(({ at }) => at.getTime() > now)
    .map(({ window: w, at }) => {
      const body = w.items
        .map((it) => `${it.reps} ${EXERCISE_LABELS[it.exercise].toLowerCase()}`)
        .join(' + ');
      return {
        id: notificationId(plan.date, w.id),
        title: `Window at ${w.at}`,
        body: body || 'Time for a set',
        schedule: { at },
        channelId: CHANNEL_ID,
      };
    });

  if (notifications.length === 0) return;
  try {
    await LocalNotifications.schedule({ notifications });
  } catch {
    // Scheduling can fail if permission was revoked between checks.
  }
}

/** Cancels every reminder for a day - used when the user turns reminders off. */
export async function cancelWindowReminders(plan: DayPlan): Promise<void> {
  if (!isNative()) return;
  try {
    await LocalNotifications.cancel({
      notifications: plan.windows.map((w) => ({ id: notificationId(plan.date, w.id) })),
    });
  } catch {
    // Nothing scheduled.
  }
}
