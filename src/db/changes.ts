/** Sync bookkeeping that has to survive a merge.
 *
 * Kept in localStorage rather than a Dexie table because the tables themselves
 * are what sync rewrites: a cursor stored beside the data would be overwritten
 * by whatever the other device happened to have, and every device would then
 * claim to have already seen every row.
 */

/** How far this device has read the cloud. It's the greatest `updatedAt` of any
 * record pulled so far, so the next pull asks only for what's newer. Zero means
 * "never pulled", which reads the account from the beginning - exactly what a
 * fresh install on a new phone needs. */
const PULL_CURSOR = 'rungs.pullCursor';

/** How far this device has uploaded, as the greatest `updatedAt` of any local
 * row already pushed. Kept apart from the pull cursor because the two count
 * different clocks: local rows are stamped by this device, cloud rows by
 * whichever device wrote them. Comparing one to the other would let a device
 * whose clock runs slow decide it had already uploaded work it hadn't. */
const PUSH_WATERMARK = 'rungs.pushWatermark';

/** When the last full sync pass finished, for the UI's "last saved" line. This
 * is display only; no merge decision reads it. */
const SYNCED_AT = 'rungs.syncedAt';

/** Which account the positions above belong to.
 *
 * Without this the cursor is a number with no owner, and signing from one
 * account straight into another silently hands the second the first's read
 * position. The second account's records are all older than that cursor, so
 * the pull matches nothing, reports a clean empty sync, and the device then
 * uploads its own state over an account whose history it never read.
 *
 * Signing out cleared the cursor and hid this, so it only happened when
 * switching accounts directly - which is exactly what "Already have an
 * account?" on a device that has been signed in before does.
 */
const CURSOR_OWNER = 'rungs.cursorOwner';

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
    // Private-mode storage failures shouldn't break logging a set. A device
    // that can't keep a cursor re-reads the account from scratch each session,
    // which is slower but still correct - merging is idempotent.
  }
}

/** Called by every db write, so the auto-sync scheduler can debounce against
 * real activity instead of polling. Cheap by design - it runs on each logged
 * set. */
export function markChanged(): void {
  for (const fn of listeners) fn();
}

/** Points the sync bookkeeping at `uid`, clearing it if it belonged to someone
 * else. Call before the first pass for an account; it is a no-op once the
 * stored owner already matches, so every later pass keeps its position.
 *
 * Returns true when the positions were cleared, so a caller can tell a resumed
 * sync from one that is about to read an account from the beginning. */
export function adoptAccount(uid: string): boolean {
  let owner: string | null = null;
  try {
    owner = localStorage.getItem(CURSOR_OWNER);
  } catch {
    // Unreadable storage means no trustworthy owner, so treat it as a change
    // and read from the beginning - the safe direction to be wrong in.
  }
  if (owner === uid) return false;

  resetChangeMarks();
  try {
    localStorage.setItem(CURSOR_OWNER, uid);
  } catch {
    // A device that can't remember the owner re-reads each session. Slower,
    // still correct: merging is idempotent.
  }
  return true;
}

export function pullCursor(): number {
  return read(PULL_CURSOR);
}

/** Advances the read position. Only ever moves forward: an out-of-order or
 * retried pull must not rewind the cursor and re-download the account. */
export function markPulled(throughUpdatedAt: number): void {
  if (throughUpdatedAt > pullCursor()) write(PULL_CURSOR, throughUpdatedAt);
}

export function pushWatermark(): number {
  return read(PUSH_WATERMARK);
}

/** Advances the upload position. Forward-only for the same reason the pull
 * cursor is: a retried pass must not rewind and re-upload the account. */
export function markPushed(throughUpdatedAt: number): void {
  if (throughUpdatedAt > pushWatermark()) write(PUSH_WATERMARK, throughUpdatedAt);
}

export function lastSyncedAt(): number {
  return read(SYNCED_AT);
}

export function markSynced(at: number = Date.now()): void {
  write(SYNCED_AT, at);
}

export function onLocalChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Forgets this device's read position. Used when signing out or resetting, so
 * the next account is read from the beginning instead of inheriting a cursor
 * pointing into someone else's history. */
export function resetChangeMarks(): void {
  try {
    localStorage.removeItem(PULL_CURSOR);
    localStorage.removeItem(PUSH_WATERMARK);
    localStorage.removeItem(SYNCED_AT);
    localStorage.removeItem(CURSOR_OWNER);
  } catch {
    // Nothing to do; the cursor is an optimisation, not a correctness input.
  }
}
