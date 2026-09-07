/** Firestore rejects `undefined` as a field value outright, while Dexie stores
 * an absent optional field as exactly that - so a profile that never set
 * `windowTimes` arrives with the key present and the value undefined.
 * Dropping those keys is lossless: reading the row back gives `undefined` for a
 * missing key either way, which is what the optional field meant.
 *
 * This has to recurse, because the optional fields aren't only top-level: a
 * `DayPlan` holds windows, which hold items, which hold an optional `ladder`.
 * Arrays are rebuilt rather than filtered - dropping an element would shift
 * every index after it, so an undefined slot becomes null and keeps its place.
 *
 * Kept apart from `sync.ts` so it can be exercised without pulling in the
 * Firebase SDK.
 */
export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => (v === undefined ? null : stripUndefined(v))) as unknown as T;
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v !== undefined) out[key] = stripUndefined(v);
    }
    return out as T;
  }
  return value;
}
