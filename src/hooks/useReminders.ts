import { useEffect } from 'react';
import { getProfile, getSettings } from '../db';
import { generateDayPlan } from '../engine/planGenerator';
import { localDate, dayIndexFor, timeToMinutes, nowMinutes } from '../engine/dates';
import { isNative, scheduleWindowReminders, hasNotificationPermission } from '../engine/notifications';
import { EXERCISE_LABELS } from '../types';

const CHECK_INTERVAL_MS = 30_000;
const LEAD_MINUTES = 5;

/**
 * Keeps window reminders in sync with the day's plan.
 *
 * On Android these are scheduled with the OS, so they fire whether or not the
 * app is running. On the web there's no such thing without a push server, so
 * we fall back to polling and firing a Notification while the tab is open.
 */
export function useReminders() {
  useEffect(() => {
    const fired = new Set<string>();

    const check = async () => {
      const settings = await getSettings();
      if (!settings.reminders) return;
      if (!(await hasNotificationPermission())) return;

      const profile = await getProfile();
      if (!profile) return;

      const today = localDate();
      const dayIndex = dayIndexFor(profile.createdAt, today);
      const plan = await generateDayPlan(today, dayIndex, profile);

      if (isNative()) {
        // Hand the whole day to the OS; it will fire them without us.
        await scheduleWindowReminders(plan, profile);
        return;
      }

      const nowMin = nowMinutes();
      for (const w of plan.windows) {
        if (w.status !== 'pending' && w.status !== 'reflowed') continue;
        const key = `${today}-${w.id}`;
        if (fired.has(key)) continue;

        const minutesUntil = timeToMinutes(w.at) - nowMin;
        if (minutesUntil <= LEAD_MINUTES && minutesUntil >= 0) {
          const item = w.items[0];
          const body = item ? `${item.reps} ${EXERCISE_LABELS[item.exercise].toLowerCase()} at ${w.at}` : `Window at ${w.at}`;
          new Notification('Coming up', { body, tag: key });
          fired.add(key);
        }
      }
    };

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);
}
