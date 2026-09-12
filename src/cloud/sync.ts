import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, where, orderBy,
  limit as fsLimit, writeBatch, serverTimestamp, getCountFromServer,
} from 'firebase/firestore';
import { cloudDb } from './firebase';
import { stripUndefined } from './serialize';
import { deviceId, deviceLabel } from './device';
import {
  changedSince, liveCount, mergeRecords, TABLE_NAMES,
  type SyncRecord, type SyncedTable,
} from '../db';

/** The sync model, in one place.
 *
 * There is a single copy of the data. Every device holds all of it, and every
 * row carries the time it was last written. When two devices hold the same
 * row, the later stamp is the row - that's the entire conflict resolution.
 *
 * The consequence worth stating plainly is what it buys: two devices are never
 * in an unresolvable state, because there is no state to resolve. A device
 * that was offline for a week uploads its week and downloads everyone else's;
 * both survive, because they're different rows. The only thing that can be
 * lost is one of two edits to the *same* row, and only the older one - which
 * is what "the last update is the final update" means.
 *
 * Rows are stored one Firestore document each rather than as one big blob.
 * That's what makes the merge per-row instead of per-device: a blob can only
 * be replaced wholesale, so whoever wrote last would erase the other's week
 * even though the two never touched the same day.
 */

/** How much day-by-day detail the cloud keeps. Progress lives in `dayRecords`
 * (per-day totals and streak credit) and `baselineLogs` (max tests) - both
 * kept in full, forever, because they're the record of how far someone has
 * come. What ages out is the fine grain: which individual sets were done at
 * what tempo, and what each past day was scheduled to be. */
const DETAIL_RETENTION_DAYS = 183;

/** Tables holding day-by-day detail, pruned to the retention window above. */
const PRUNED_TABLES: SyncedTable[] = ['setLogs', 'dayPlans'];

/** Firestore caps a batch at 500 writes. */
const BATCH_LIMIT = 450;

/** How many changed documents one pull reads. A device returning after a long
 * gap pages through rather than asking for an unbounded result set. */
const PAGE_SIZE = 500;

/** The oldest date the cloud keeps detail for, as YYYY-MM-DD. */
function retentionCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - DETAIL_RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Drops detail records older than the retention window, so an old set log
 * isn't re-uploaded forever. Compared on the row's `date` field, YYYY-MM-DD,
 * which sorts correctly as a plain string. A row without one is kept rather
 * than guessed at. */
function withinRetention(record: SyncRecord, cutoff: string): boolean {
  if (!PRUNED_TABLES.includes(record.table)) return true;
  const date = record.row.date;
  return typeof date !== 'string' || date >= cutoff;
}

export interface BackupMeta {
  updatedAt: number;
  appVersion: string;
  counts: Record<string, number>;
  /** Records the server counted in this account, or null if the count failed.
   * Authoritative, unlike `counts`, which the last device wrote about itself. */
  cloudRecords?: number | null;
  deviceId?: string;
  deviceLabel?: string;
}

function userRoot(uid: string) {
  return doc(cloudDb(), 'users', uid);
}

/** Every synced row lives in one flat collection rather than one per table.
 *
 * A pull is "give me everything stamped after my cursor", and a flat
 * collection answers that with a single indexed query. Split per table it
 * would be one query per table on every sync, each needing its own cursor -
 * seven times the round trips to answer the same question. */
function recordsRef(uid: string) {
  return collection(cloudDb(), 'users', uid, 'records');
}

/** A record's document id. The table is part of the key because two tables can
 * legitimately use the same id - a `dayPlans` row and a `dayRecords` row for
 * the same day both key on that date - and merging them into one document
 * would have each silently overwrite the other. */
function docIdFor(table: SyncedTable, id: string): string {
  return `${table}~${encodeURIComponent(id)}`;
}

/** Whether the account has been written in the record format at all. Asks for
 * a single document rather than counting, because the only question is
 * "has this account been converted yet". */
async function hasRecords(uid: string): Promise<boolean> {
  const probe = await getDocs(query(recordsRef(uid), fsLimit(1)));
  return !probe.empty;
}

/** Tables as the pre-record backup stored them: one chunked collection each,
 * under users/{uid}/backup/{table}/chunks. Kept only long enough to convert. */
function legacyChunksRef(uid: string, table: SyncedTable) {
  return collection(cloudDb(), 'users', uid, 'backup', table, 'chunks');
}

/** Converts an account written by the old whole-snapshot backup into records,
 * once, on the first sync after updating.
 *
 * Without this the account would look empty to the new code: the records
 * collection doesn't exist yet, so a device pulling would find nothing and a
 * user opening the app on a second phone would be told their history is gone.
 *
 * The converted rows are written with the stamps they already carry, not with
 * `now`. That matters: stamping the whole history as if it were written at
 * migration time would make it beat genuinely newer work on a device that
 * hasn't migrated its own copy yet. Rows that predate stamping fall back to
 * the times they already record - when a set was completed, when a baseline
 * was tested - so the merge orders them roughly as they actually happened.
 *
 * Returns the records it converted, so the caller can merge them locally in
 * the same pass rather than waiting for the next one.
 */
async function migrateLegacyBackup(uid: string): Promise<SyncRecord[]> {
  const converted: SyncRecord[] = [];

  for (const table of TABLE_NAMES) {
    const snap = await getDocs(legacyChunksRef(uid, table));
    if (snap.empty) continue;
    // Chunk ids are zero-padded indices, so sorting by id restores the row
    // order the old backup wrote them in.
    const docs = [...snap.docs].sort((a, b) => a.id.localeCompare(b.id));
    for (const d of docs) {
      const rows = (d.data().rows ?? []) as Record<string, unknown>[];
      for (const row of rows) {
        const id = row[LEGACY_KEYS[table]];
        if (id === undefined || id === null) continue;
        const updatedAt = legacyStamp(table, row);
        converted.push({
          table,
          id: String(id),
          updatedAt,
          row: { ...row, updatedAt },
        });
      }
    }
  }

  if (converted.length > 0) await uploadRecords(uid, converted);
  return converted;
}

/** Which field each table keys on, matching `SYNCED_TABLES` in the db layer. */
const LEGACY_KEYS: Record<SyncedTable, string> = {
  profile: 'id', baselineLogs: 'id', dayPlans: 'id', setLogs: 'id',
  dayRecords: 'date', settings: 'id', streaks: 'id',
};

/** The best available "when was this written" for a row from the old backup,
 * which carried no sync stamp of its own. */
function legacyStamp(table: SyncedTable, row: Record<string, unknown>): number {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  const fromDate = (v: unknown) => {
    const t = typeof v === 'string' ? Date.parse(v) : NaN;
    return Number.isNaN(t) ? 0 : t;
  };
  switch (table) {
    case 'setLogs': return num(row.completedAt) || fromDate(row.date);
    case 'baselineLogs': return num(row.testedAt);
    case 'profile': return num(row.createdAt);
    case 'dayPlans':
    case 'dayRecords': return fromDate(row.date);
    // The singletons carry no time of their own. Zero makes them lose to any
    // stamped copy, which is right: a device still running is a better source
    // for current settings and a derived streak than a migrated snapshot.
    default: return 0;
  }
}

/** Deletes the old chunked backup once its rows are safely stored as records.
 * Best-effort: leaving it behind wastes space but breaks nothing, so a failure
 * here must not fail a sync that already succeeded. */
async function dropLegacyBackup(uid: string): Promise<void> {
  const db = cloudDb();
  try {
    for (const table of TABLE_NAMES) {
      const snap = await getDocs(legacyChunksRef(uid, table));
      if (snap.empty) continue;
      for (let i = 0; i < snap.docs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        for (const d of snap.docs.slice(i, i + BATCH_LIMIT)) batch.delete(d.ref);
        await batch.commit();
      }
    }
  } catch {
    // Ignored: the records are already written, which is what matters.
  }
}

/** Reads every record the cloud received after `since`, in arrival order.
 *
 * The cursor tracks `seq` - when the server received a record - and
 * deliberately not `updatedAt`, which is when the device wrote it. The two
 * come apart exactly when it matters most: a phone that logged a set on
 * Monday and didn't reconnect until Friday uploads a row stamped Monday, long
 * after another device has read past Monday. Ordered by `updatedAt`, that row
 * sits below every other device's cursor and is never delivered to any of
 * them - the set is in the cloud, and no device ever sees it again.
 *
 * Arrival order has no such hole: a record uploaded now gets a `seq` above
 * every cursor, whatever its own timestamp says. `updatedAt` still decides who
 * wins a merge; `seq` only decides who has been told.
 *
 * Ordering by it also makes an interrupted pull safe to resume, since the
 * cursor advances only across records that actually landed.
 */
async function fetchChangedRecords(uid: string, since: number): Promise<PulledPage> {
  const records: SyncRecord[] = [];
  let cursor = since;

  for (;;) {
    const page = await getDocs(query(
      recordsRef(uid),
      where('seq', '>', cursor),
      orderBy('seq'),
      fsLimit(PAGE_SIZE)
    ));
    if (page.empty) break;

    let highest = cursor;
    for (const d of page.docs) {
      const data = d.data();
      highest = Math.max(highest, seqMillis(data.seq));
      const table = data.table as SyncedTable;
      // A document naming a table this build doesn't have is from a newer
      // version of the app. Skipping it is better than failing the whole sync:
      // the rest of the account still merges, and the row is picked up
      // untouched once this device updates.
      if (!TABLE_NAMES.includes(table)) continue;
      records.push({
        table,
        id: String(data.id),
        updatedAt: Number(data.updatedAt) || 0,
        ...(data.deletedAt ? { deletedAt: Number(data.deletedAt) } : {}),
        row: (data.row ?? {}) as Record<string, unknown>,
      });
    }

    // A full page whose last seq equals the cursor would loop forever. That
    // needs PAGE_SIZE records sharing one sequence value, which the writer
    // makes impossible, but a sync that spins is worse than one that stops a
    // page early.
    if (highest <= cursor) break;
    cursor = highest;
    if (page.docs.length < PAGE_SIZE) break;
  }

  return { records, cursor };
}

interface PulledPage {
  records: SyncRecord[];
  /** How far the cloud has been read, in arrival order. */
  cursor: number;
}

/** `seq` comes back as a Firestore Timestamp. Reduced to milliseconds so the
 * cursor is a plain number that survives localStorage. A record written by a
 * client that couldn't resolve the sentinel reads as 0, which keeps it below
 * every cursor - it will be re-read on the next full sync rather than skipped
 * silently. */
function seqMillis(value: unknown): number {
  if (value && typeof value === 'object' && 'toMillis' in value) {
    return (value as { toMillis(): number }).toMillis();
  }
  return Number(value) || 0;
}

/** Uploads records, newest-stamp-wins being enforced by the merge on the way
 * back down rather than by a read-before-write here.
 *
 * A blind write is safe because it's the same rule either way: if this device
 * writes an older row over a newer one, the newer one is still stamped newer,
 * and the next device to pull - including this one - keeps the newer. Checking
 * first would cost a read per row to reach the same place. */
async function uploadRecords(uid: string, records: SyncRecord[]): Promise<void> {
  const db = cloudDb();
  for (let i = 0; i < records.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    for (const record of records.slice(i, i + BATCH_LIMIT)) {
      batch.set(doc(recordsRef(uid), docIdFor(record.table, record.id)), stripUndefined({
        table: record.table,
        id: record.id,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt ?? null,
        // The server's own clock, so arrival order is decided by one clock
        // rather than by whichever device happened to be fast or slow. Written
        // as a sentinel the server resolves, which is why it can't be read back
        // from the object we just sent.
        seq: serverTimestamp(),
        row: record.row,
      }));
    }
    await batch.commit();
  }
}

export interface SyncResult {
  /** Records merged into the local database. */
  pulled: number;
  /** Records uploaded from this device. */
  pushed: number;
  /** How far the cloud has now been read, in the cloud's stamps. */
  cursor: number;
  /** How far this device has now uploaded, in this device's stamps. */
  watermark: number;
  /** True when the merge changed local data, so the UI has to be rebuilt from
   * the database rather than trusting what it already read. */
  changed: boolean;
}

/** One sync pass: take everything new from the cloud, then give it everything
 * new from here.
 *
 * Pull runs first so an upload never has to reason about what the cloud
 * already holds - by the time this device writes, it has already merged
 * whatever the other device did.
 *
 * The two positions are tracked separately and never compared. `since` is a
 * position in the cloud's ordering, made of stamps written by other devices;
 * `pushedThrough` is a position in this device's own clock. Treating them as
 * one number would mean a device whose clock differs from its peers' by even a
 * few seconds could skip its own unsent rows - the one bug in a last-write-wins
 * design that loses data silently.
 *
 * Pass 0 for both to sync an account from the beginning, which is what a fresh
 * install on a new phone does.
 */
export async function syncRecords(
  uid: string,
  appVersion: string,
  since: number,
  pushedThrough: number
): Promise<SyncResult> {
  // An account written by the previous backup format has no records yet, so a
  // plain pull would report it empty and a second device would be told its
  // history was gone. Converting first is what makes updating the app
  // invisible to someone who already had a backup. Only ever runs when the
  // records collection is genuinely empty, so it can't re-run and resurrect
  // rows the user has since deleted.
  let { records: incoming, cursor } = await fetchChangedRecords(uid, since);
  if (incoming.length === 0 && since === 0 && !(await hasRecords(uid))) {
    const migrated = await migrateLegacyBackup(uid);
    if (migrated.length > 0) {
      await dropLegacyBackup(uid);
      // Re-read rather than trusting what was just written: the migration's
      // records only have a `seq` once the server has resolved it, and the
      // cursor has to reflect that value or the next pull re-delivers them all.
      ({ records: incoming, cursor } = await fetchChangedRecords(uid, since));
    }
  }

  const applied = await mergeRecords(incoming);

  // Everything written on this device since its last upload. Rows the merge
  // just wrote carry the stamp of the device that wrote them, so a merged row
  // that lost to a local edit still shows up here and travels back out.
  const cutoff = retentionCutoff();
  const outgoing = (await changedSince(pushedThrough)).filter((r) => withinRetention(r, cutoff));

  // A row that just arrived from the cloud and wasn't touched since is already
  // up there; sending it back is a write that changes nothing.
  const merged = new Map(incoming.map((r) => [docIdFor(r.table, r.id), r.updatedAt]));
  let toPush = outgoing.filter((r) => {
    const seen = merged.get(docIdFor(r.table, r.id));
    return seen === undefined || r.updatedAt > seen;
  });

  // Refuse to write a freshly-onboarded device over an account it failed to
  // read. If this pass merged nothing while the account holds records, the
  // pull did not work - a stale cursor, a refused read, a dropped connection -
  // and last-write-wins will happily let this device's brand-new profile and
  // baselines beat the real ones, because they genuinely are newer. The user
  // sees their history vanish, and no later sync brings it back.
  //
  // Withholding the push is always recoverable: the local rows keep their
  // stamps and go up on the next pass that reads successfully. Allowing it is
  // not. So when the two disagree, the copy nobody has read yet is the one to
  // protect.
  if (applied === 0 && toPush.length > 0) {
    const cloudCount = await countCloudRecords(uid);
    if (cloudCount !== null && cloudCount > 0) {
      const localNew = toPush.filter((r) => !merged.has(docIdFor(r.table, r.id)));
      // Every row is new to an account that already has data: this device has
      // never seen it, so it is not a peer with newer work - it is an empty
      // device about to become the account.
      if (localNew.length === toPush.length) {
        throw new Error(
          `Sync stopped to protect your data: this account has ${cloudCount} records ` +
          `that this device hasn't loaded yet. Nothing was overwritten. Try again, ` +
          `or sign out and back in.`
        );
      }
    }
  }

  // Per record, for the ones that say who the user is.
  //
  // The check above only catches a device that is wholly empty. A device that
  // merged even one row, or that holds one stale row of its own, walks past it
  // and can still put a blank profile over a real one - and because the blank
  // was written seconds ago it is genuinely newer, so last-write-wins accepts
  // it. Stamps cannot tell "the user re-onboarded by accident" from "the user
  // legitimately edited their name"; only the content can.
  //
  // So: if the server's copy looks like a real record and the copy about to
  // replace it does not, the write is refused. Going the other way is always
  // allowed, and so is replacing one real record with another - this blocks
  // the hollowing-out, not editing.
  const identity = toPush.filter((r) => IDENTITY_TABLES.includes(r.table) && !r.deletedAt);
  if (identity.length > 0) {
    const server = await fetchServerRecords(uid, identity);
    const hollowed = identity.filter((r) => {
      const theirs = server.get(docIdFor(r.table, r.id));
      if (!theirs) return false;
      return looksSubstantive(r.table, theirs.row) && !looksSubstantive(r.table, r.row);
    });

    if (hollowed.length > 0) {
      const names = [...new Set(hollowed.map((r) => r.table))].join(', ');
      throw new Error(
        `Sync stopped to protect your data: this device was about to replace your ` +
        `stored ${names} with an empty copy. Nothing was overwritten. Try again, ` +
        `or sign out and back in.`
      );
    }

    // A real record on this device that is *older* than the server's is not a
    // threat - the merge would have kept the server's anyway - but sending it
    // wastes a write and muddies the watermark. Dropped rather than refused.
    const stale = new Set(
      identity
        .filter((r) => {
          const theirs = server.get(docIdFor(r.table, r.id));
          return theirs !== undefined && theirs.updatedAt > r.updatedAt;
        })
        .map((r) => docIdFor(r.table, r.id))
    );
    if (stale.size > 0) {
      toPush = toPush.filter((r) => !stale.has(docIdFor(r.table, r.id)));
    }
  }

  if (toPush.length > 0) await uploadRecords(uid, toPush);

  // The watermark moves past everything just uploaded, so a quiet sync that
  // follows finds nothing to send. It's exclusive of rows written while the
  // upload was in flight, which keep a later stamp and go out next pass.
  const watermark = toPush.reduce(
    (max, r) => (r.updatedAt > max ? r.updatedAt : max),
    pushedThrough
  );

  await writeMeta(uid, appVersion);

  return { pulled: applied, pushed: toPush.length, cursor, watermark, changed: applied > 0 };
}

/** Records what the account looks like now, for the UI's status line.
 *
 * The counts come from the local tables rather than from the cloud, which is
 * accurate precisely because the pass that just ran made the two agree. It's a
 * summary, not a source of truth: no merge decision reads it, so failing to
 * write it can't corrupt anything, and the sync is already complete by the
 * time this runs.
 */
async function writeMeta(uid: string, appVersion: string): Promise<void> {
  try {
    const counts: Record<string, number> = {};
    for (const table of TABLE_NAMES) counts[table] = await liveCount(table);
    await setDoc(userRoot(uid), {
      updatedAt: Date.now(),
      appVersion,
      counts,
      deviceId: deviceId(),
      deviceLabel: deviceLabel(),
      syncedAt: serverTimestamp(),
    }, { merge: true });
  } catch {
    // The data is already synced; a missing status line is cosmetic.
  }
}

/** The records that carry who the user is, rather than what they did on a
 * given day.
 *
 * These are the ones worth a round trip to protect. A set log is one entry
 * among hundreds and losing it costs a row; the profile is the name, the tier
 * and the schedule, and the baselines are the numbers every future session is
 * sized from. Onboarding rewrites exactly these, which is what makes an
 * accidental re-onboarding destructive rather than merely untidy.
 */
const IDENTITY_TABLES: SyncedTable[] = ['profile', 'baselineLogs', 'settings'];

/** Whether `row` looks like a real record rather than a placeholder.
 *
 * Deliberately shallow. The question is not "is this good data" - that is the
 * app's job - but "did something write an empty shell over a real record",
 * which is what a fresh onboarding pass looks like from here.
 */
function looksSubstantive(table: SyncedTable, row: Record<string, unknown>): boolean {
  if (table === 'profile') {
    return Boolean(row.onboardingComplete) && typeof row.name === 'string' && row.name.length > 0;
  }
  if (table === 'baselineLogs') {
    return typeof row.maxReps === 'number' && row.maxReps > 0;
  }
  return true;
}

/** Reads the server's copy of the identity records this push would replace.
 *
 * One `getDoc` per record, and there are only ever a handful of them, so this
 * costs a few reads on the passes that touch identity and nothing at all on
 * the ones that don't.
 */
async function fetchServerRecords(
  uid: string,
  records: SyncRecord[]
): Promise<Map<string, { updatedAt: number; row: Record<string, unknown> }>> {
  const out = new Map<string, { updatedAt: number; row: Record<string, unknown> }>();
  await Promise.all(records.map(async (r) => {
    const key = docIdFor(r.table, r.id);
    try {
      const snap = await getDoc(doc(recordsRef(uid), key));
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.deletedAt) return;
      out.set(key, {
        updatedAt: Number(data.updatedAt) || 0,
        row: (data.row ?? {}) as Record<string, unknown>,
      });
    } catch {
      // A read that fails tells us nothing, and nothing is not evidence that
      // the server copy is absent. Left out of the map, which the caller
      // treats as "no reason to block".
    }
  }));
  return out;
}

/** How many records the account actually holds, counted by the server.
 *
 * This exists because the summary document cannot answer the question. Its
 * counts are written by whichever device synced last, from that device's own
 * tables - so a phone that syncs while empty stamps the account as empty, and
 * the next screen to read it tells the user their history is gone while every
 * record still sits in the collection untouched. Saying that to someone who
 * has just signed in on a new phone is the worst thing this screen can do.
 *
 * An aggregation query, so the cost is one read and nothing is downloaded.
 * Returns null when the count can't be taken - which is different from zero
 * and must stay different, since "I don't know" and "there is nothing" are the
 * two answers most dangerous to confuse here.
 */
export async function countCloudRecords(uid: string): Promise<number | null> {
  try {
    const snap = await getCountFromServer(recordsRef(uid));
    return snap.data().count;
  } catch {
    return null;
  }
}

/** Reads the account's summary without downloading the data, so the UI can say
 * what's up there.
 *
 * `cloudRecords` is the authoritative half: counted on the server, from the
 * records themselves. The `counts` map beside it is the last writing device's
 * view and is kept only for the per-table detail, which no decision should
 * rest on. */
export async function fetchBackupMeta(uid: string): Promise<BackupMeta | null> {
  const [snap, cloudRecords] = await Promise.all([
    getDoc(userRoot(uid)),
    countCloudRecords(uid),
  ]);

  // A missing summary document no longer means an empty account: the records
  // are the account, and the summary is a convenience written after them.
  if (!snap.exists()) {
    return cloudRecords && cloudRecords > 0
      ? { updatedAt: 0, appVersion: '', counts: {}, cloudRecords }
      : null;
  }

  const data = snap.data();
  return {
    updatedAt: data?.updatedAt ?? 0,
    appVersion: data?.appVersion ?? '',
    counts: data?.counts ?? {},
    deviceId: data?.deviceId,
    deviceLabel: data?.deviceLabel,
    cloudRecords,
  };
}

/** Removes the account's cloud copy entirely. Local data is untouched.
 *
 * Deleting the documents outright, rather than tombstoning them, is right here
 * because the user is asking for the cloud copy to stop existing - not for the
 * data to be removed from their other devices. A device that pulls afterwards
 * simply finds an empty account and uploads its own copy again. */
export async function deleteBackup(uid: string): Promise<void> {
  const db = cloudDb();
  for (;;) {
    const page = await getDocs(query(recordsRef(uid), fsLimit(BATCH_LIMIT)));
    if (page.empty) break;
    const batch = writeBatch(db);
    for (const d of page.docs) batch.delete(d.ref);
    await batch.commit();
    if (page.docs.length < BATCH_LIMIT) break;
  }
  await deleteDoc(userRoot(uid));
}
