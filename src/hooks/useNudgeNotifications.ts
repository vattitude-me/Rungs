import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from './useCloudSync';

/** Surfaces friend nudges as notifications on platforms the push worker can't
 * reach.
 *
 * The split is the same one the whole notification story has (see the reminder
 * worker): an installed web app has an FCM token, so the worker pushes nudges
 * to it whether or not it is open. The Android build has no FCM token at all -
 * it uses `@capacitor/local-notifications` against the OS scheduler and never
 * registers for messaging - so a nudge sent to it would sit in the inbox
 * unseen until the user happened to open Squad.
 *
 * This closes that gap without adding a native messaging dependency: while the
 * app is open, the inbox is already being watched live for the Squad badge, so
 * a new item can raise a local notification directly. The limitation is honest
 * and worth stating - on Android a nudge arriving while the app is closed is
 * seen when the app is next opened, not before.
 *
 * Web is excluded because the worker already delivers there, and doing both
 * would show every nudge twice.
 */
export function useNudgeNotifications(): void {
  const { account } = useCloudSync();
  const uid = account?.uid;

  useEffect(() => {
    if (!cloudConfigured || !uid) return;
    if (!Capacitor.isNativePlatform()) return;

    // Everything already in the inbox on the first tick is backlog, not news.
    // Announcing it would mean a burst of notifications every time the app
    // opens, for nudges the user has very likely already seen.
    let seen: Set<string> | null = null;
    let stop: (() => void) | undefined;
    let cancelled = false;

    void (async () => {
      const [friends, notifications] = await Promise.all([
        import('../cloud/friends'),
        import('../engine/notifications'),
      ]);
      if (cancelled) return;

      stop = friends.watchInbox(uid, (items) => {
        if (seen === null) {
          seen = new Set(items.map((i) => i.id));
          return;
        }
        const fresh = items.filter((i) => !seen!.has(i.id));
        for (const item of items) seen.add(item.id);
        if (fresh.length === 0) return;

        void notifications.showFriendNudges(fresh.map((item) => ({
          id: item.id,
          title: item.kind === 'request' ? 'Friend request' : 'Rungs',
          body: item.kind === 'request'
            ? `${item.fromName} wants to be friends`
            : `${item.fromName} ${friends.phraseText(item.phrase ?? '')}`,
        })));
      });
    })();

    return () => { cancelled = true; stop?.(); };
  }, [uid]);
}
