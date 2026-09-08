import {
  lastSyncedAt, markPulled, markPushed, markSynced, onLocalChange,
  pullCursor, pushWatermark, resetChangeMarks,
} from '../db/changes';

/** How long the app waits after the last local write before syncing. Long
 * enough that a whole set-logging session collapses into one pass, short
 * enough that closing the app right after a session has usually already
 * synced. */
const DEBOUNCE_MS = 6000;

export type SyncState =
  | { status: 'idle'; lastSyncedAt: number }
  | { status: 'syncing' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

/** Runs `fn` once the user has been quiet for the debounce window, collapsing
 * a burst of writes into a single sync. Returns an unsubscribe function. */
export function scheduleOnChange(fn: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = onLocalChange(() => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, DEBOUNCE_MS);
  });
  return () => {
    if (timer) clearTimeout(timer);
    stop();
  };
}

export {
  lastSyncedAt, markPulled, markPushed, markSynced, pullCursor, pushWatermark,
  resetChangeMarks,
};
