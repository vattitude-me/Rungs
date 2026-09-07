/** Tracks that local data has changed since the last successful upload, so
 * sync can tell "this device has work the cloud hasn't seen" apart from "this
 * device is empty and should download".
 *
 * Kept in localStorage rather than a Dexie table for the same reason the
 * device id is: a restore replaces every table, so a marker stored there would
 * be overwritten by the backup's own value.
 */
const CHANGED_AT = 'rungs.changedAt';
const SYNCED_AT = 'rungs.syncedAt';
/** The backup generation this device is in step with - the `updatedAt` of the
 * backup it last pushed or pulled. Compared for equality, never ordering, so
 * it stays correct across devices whose clocks disagree. */
const SYNCED_GENERATION = 'rungs.syncedGeneration';

type Listener = () => void;
const listeners = new Set<Listener>();

function read(key: string): number {
  try {
    return Number(localStorage.getItem(key) ?? 0) || 0;
  } catch {
    return 0;
  }
}

function write(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Private-mode storage failures shouldn't break logging a set. Sync just
    // falls back to treating the device as always-dirty for this session.
  }
}

/** Called by every db write. Cheap by design - it runs on each logged set. */
export function markChanged(): void {
  write(CHANGED_AT, Date.now());
  for (const fn of listeners) fn();
}

/** Called after a successful upload, recording that the cloud now matches.
 *
 * `at` must come from the same clock as `markChanged` - i.e. this device's -
 * because `hasUnsyncedChanges` compares the two directly. Passing a
 * server-derived timestamp here would mix clocks and, on a device running
 * slightly ahead, leave it looking permanently dirty.
 *
 * Pass the time the upload *started*: anything written while it was in flight
 * didn't make it into that upload and must still count as unsynced. */
export function markSynced(at: number = Date.now()): void {
  write(SYNCED_AT, at);
}

export function lastChangedAt(): number {
  return read(CHANGED_AT);
}

export function lastSyncedAt(): number {
  return read(SYNCED_AT);
}

/** Records which backup generation this device now matches, after a push or a
 * pull. */
export function markGeneration(updatedAt: number): void {
  write(SYNCED_GENERATION, updatedAt);
}

export function syncedGeneration(): number {
  return read(SYNCED_GENERATION);
}

/** True when this device holds writes the cloud hasn't got. */
export function hasUnsyncedChanges(): boolean {
  const changed = lastChangedAt();
  return changed > 0 && changed > lastSyncedAt();
}

/** Notifies on local writes, so the auto-sync scheduler can debounce against
 * real activity instead of polling. */
export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forgets both marks. Used when signing out or resetting, so the next account
 * starts from a clean slate rather than inheriting someone else's clock. */
export function resetChangeMarks(): void {
  try {
    localStorage.removeItem(CHANGED_AT);
    localStorage.removeItem(SYNCED_AT);
    localStorage.removeItem(SYNCED_GENERATION);
  } catch {
    // Nothing to do; the marks are advisory.
  }
}
