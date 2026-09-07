import {
  hasUnsyncedChanges, lastChangedAt, lastSyncedAt, markGeneration, markSynced,
  onLocalChange, resetChangeMarks, syncedGeneration,
} from '../db/changes';
import { exportSnapshot } from '../db';
import { deviceId } from './device';
import type { BackupMeta } from './sync';

/** How long the app waits after the last local write before uploading. Long
 * enough that a whole set-logging session collapses into one upload, short
 * enough that closing the app right after a session has usually already
 * synced. */
const DEBOUNCE_MS = 6000;

export type SyncState =
  | { status: 'idle'; lastSyncedAt: number }
  | { status: 'syncing' }
  | { status: 'offline' }
  | { status: 'error'; message: string };

/** Which way data should move when a signed-in device meets a backup.
 *
 * With sync automatic there's no one standing by to answer a prompt, so the
 * direction is decided from the data rather than asked. The asymmetry is
 * deliberate: uploading over someone's history destroys it, while downloading
 * onto an empty device costs nothing, so anything ambiguous resolves to
 * 'pull'. The one genuinely unsafe case - both sides hold real work that the
 * other doesn't - is the only one that stops and asks. */
export type SyncDirection = 'push' | 'pull' | 'conflict' | 'none';

export interface DecideInput {
  /** Does this device hold any user data at all? */
  localHasData: boolean;
  /** Local writes the cloud hasn't seen. */
  localDirty: boolean;
  /** The account's backup, or null when there's none yet. */
  remote: BackupMeta | null;
  /** When this device last uploaded successfully, on this device's clock.
   * Retained for diagnostics and UI; the direction itself never compares
   * timestamps across devices, since their clocks don't agree. */
  lastSyncedAt?: number;
  /** The `updatedAt` of the backup this device last pushed or pulled. Compared
   * for equality only, so it works regardless of whose clock wrote it. */
  syncedGeneration: number;
}

export function decideDirection(input: DecideInput): SyncDirection {
  const { localHasData, localDirty, remote, syncedGeneration: seen } = input;

  // Nothing in the cloud: this device is the only copy, so it becomes the
  // backup - but only if there's actually something to back up.
  if (!remote) return localHasData ? 'push' : 'none';

  // A fresh or reset install signing in: the backup is the only history that
  // exists. This is the "restore automatically on a new device" case.
  if (!localHasData) return 'pull';

  // Already in step with this exact backup - either we wrote it, or we pulled
  // it. Identity, not ordering, so it holds across disagreeing clocks and
  // survives a pull that couldn't re-stamp the remote device id.
  const inStep = remote.updatedAt === seen || remote.deviceId === deviceId() || !remote.deviceId;
  if (inStep) return localDirty ? 'push' : 'none';

  // A backup we've never seen, written by another device. With no unsynced
  // work of our own there's nothing to lose by taking it.
  if (!localDirty) return 'pull';

  // Both sides hold work the other doesn't. Either choice silently destroys
  // real training history, so this is the case that asks.
  return 'conflict';
}

/** True when the local database holds anything worth keeping. A profile alone
 * counts: someone who finished onboarding and logged nothing still has their
 * name, baseline and schedule. */
export async function localHasData(): Promise<boolean> {
  const snap = await exportSnapshot();
  return snap.profile.length > 0 || snap.setLogs.length > 0 || snap.dayRecords.length > 0;
}

/** Runs `fn` once the user has been quiet for the debounce window, collapsing
 * a burst of writes into a single upload. Returns an unsubscribe function. */
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
  hasUnsyncedChanges, lastChangedAt, lastSyncedAt, markGeneration, markSynced,
  resetChangeMarks, syncedGeneration,
};
