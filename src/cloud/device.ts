/** A stable id for this install, used to tell whether the account's backup was
 * last written from here or from somewhere else.
 *
 * Deliberately kept in localStorage rather than the Dexie tables: a restore
 * replaces every table, so a device id stored there would be overwritten by
 * the id of whichever device made the backup - and every device would claim to
 * be the same one. localStorage survives a restore and is cleared by the same
 * "reset all data" the user already understands as starting over.
 */
const KEY = 'rungs.deviceId';

function randomId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function deviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const next = randomId();
    localStorage.setItem(KEY, next);
    return next;
  } catch {
    // Private-mode browsers can throw on storage access. A per-session id still
    // lets the rest of the flow work; it just can't recognise itself later,
    // which surfaces as the same warning a genuine second device gets.
    return randomId();
  }
}

/** What this device calls itself in the "last backed up from…" warning. Kept
 * short and human rather than exact: the point is "was this you?", not
 * forensics. */
export function deviceLabel(): string {
  if (typeof navigator === 'undefined') return 'this device';
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android phone';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  return 'this device';
}
