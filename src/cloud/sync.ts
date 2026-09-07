import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, writeBatch, serverTimestamp,
} from 'firebase/firestore';
import { cloudDb } from './firebase';
import { stripUndefined } from './serialize';
import { exportSnapshot, importSnapshot, type LocalSnapshot } from '../db';

/** Tables backed up, in the order a restore should write them. */
const TABLES = [
  'profile', 'baselineLogs', 'dayPlans', 'setLogs', 'dayRecords', 'settings', 'streaks',
] as const;
type TableName = (typeof TABLES)[number];

/** Rows per Firestore document. Firestore caps a document at 1 MB and the
 * largest row type is ~1.2 KB, so 400 rows leaves a wide margin under the cap
 * while keeping the document count low. */
const CHUNK_SIZE = 400;

/** How much day-by-day detail the backup keeps. Progress is what matters, and
 * that lives in `dayRecords` (per-day totals and streak credit) and
 * `baselineLogs` (max tests) - both kept in full, forever, because they're the
 * record of how far someone has come. What ages out is the fine grain: which
 * individual sets were done at what tempo, and what each past day was
 * scheduled to be. Six months of that is plenty to look back on, and dropping
 * the rest keeps a backup small enough to stay fast and cheap. */
const DETAIL_RETENTION_DAYS = 183;

/** Tables holding day-by-day detail, pruned to the retention window above.
 * Everything else is either a summary worth keeping forever or a singleton. */
const PRUNED_TABLES: TableName[] = ['setLogs', 'dayPlans'];

/** The oldest date the backup keeps detail for, as YYYY-MM-DD. */
function retentionCutoff(): string {
  const d = new Date();
  d.setDate(d.getDate() - DETAIL_RETENTION_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Drops detail rows older than the retention window. Rows are compared on
 * their `date` field, which every pruned table carries as YYYY-MM-DD - a
 * format that sorts correctly as a plain string. A row without one is kept
 * rather than guessed at. */
function pruneForBackup(snapshot: LocalSnapshot): LocalSnapshot {
  const cutoff = retentionCutoff();
  const next = { ...snapshot };
  const rows = asRows(next);
  for (const table of PRUNED_TABLES) {
    rows[table] = (rows[table] ?? []).filter((r) => {
      const date = r.date;
      return typeof date !== 'string' || date >= cutoff;
    });
  }
  return next;
}

export interface BackupMeta {
  updatedAt: number;
  appVersion: string;
  counts: Record<TableName, number>;
}

function userRoot(uid: string) {
  return doc(cloudDb(), 'users', uid);
}

function chunksRef(uid: string, table: TableName) {
  return collection(cloudDb(), 'users', uid, 'backup', table, 'chunks');
}

/** The snapshot seen as plain rows per table. Backup code is deliberately
 * table-generic - it chunks, uploads and counts rows without caring what shape
 * they are - and Firestore stores them untyped regardless. This is the one
 * boundary where the specific row types are set aside; `importSnapshot` is
 * what puts them back. */
type RowMap = Record<TableName, Record<string, unknown>[]>;

function asRows(snapshot: LocalSnapshot): RowMap {
  return snapshot as unknown as RowMap;
}

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Uploads this device's data as the account's backup, replacing whatever was
 * there. Old chunks are deleted rather than left behind: a backup taken after
 * deleting data must not be reconstructable from a previous, longer one. */
export async function pushBackup(uid: string, appVersion: string): Promise<BackupMeta> {
  const snapshot = asRows(pruneForBackup(await exportSnapshot()));
  const db = cloudDb();

  const counts = {} as Record<TableName, number>;
  for (const table of TABLES) counts[table] = snapshot[table]?.length ?? 0;

  for (const table of TABLES) {
    const rows = snapshot[table] ?? [];
    const parts = chunk(rows, CHUNK_SIZE);

    // Clear the previous generation first, so a shrinking table doesn't leave
    // stale trailing chunks that a restore would read back as real rows.
    const existing = await getDocs(chunksRef(uid, table));
    const deletions = writeBatch(db);
    for (const d of existing.docs) deletions.delete(d.ref);
    await deletions.commit();

    // Firestore caps a batch at 500 writes; chunks are written in batches well
    // under that.
    for (let i = 0; i < parts.length; i += 100) {
      const batch = writeBatch(db);
      for (const [offset, part] of parts.slice(i, i + 100).entries()) {
        const index = i + offset;
        batch.set(doc(chunksRef(uid, table), String(index).padStart(5, '0')), {
          rows: part.map(stripUndefined),
        });
      }
      await batch.commit();
    }
  }

  const meta: BackupMeta = { updatedAt: Date.now(), appVersion, counts };
  // Written last: its presence is what marks a backup complete, so a run that
  // dies partway never advertises itself as restorable.
  await setDoc(userRoot(uid), { ...meta, syncedAt: serverTimestamp() });
  return meta;
}

/** Reads the account's backup summary without downloading the data itself, so
 * the UI can say what's up there before the user commits to overwriting. */
export async function fetchBackupMeta(uid: string): Promise<BackupMeta | null> {
  const snap = await getDoc(userRoot(uid));
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data?.counts) return null;
  return { updatedAt: data.updatedAt ?? 0, appVersion: data.appVersion ?? '', counts: data.counts };
}

/** Replaces this device's data with the account's backup. */
export async function pullBackup(uid: string): Promise<LocalSnapshot> {
  const meta = await fetchBackupMeta(uid);
  if (!meta) throw new Error('There is no backup on this account yet.');

  const restored = {} as RowMap;
  for (const table of TABLES) {
    const snap = await getDocs(chunksRef(uid, table));
    // Chunk ids are zero-padded indices, so sorting by id restores the original
    // row order rather than Firestore's arbitrary document order.
    const docs = [...snap.docs].sort((a, b) => a.id.localeCompare(b.id));
    const rows = docs.flatMap((d) => (d.data().rows ?? []) as Record<string, unknown>[]);

    // A table whose chunks don't add up to what the summary promised means an
    // interrupted or partly-deleted backup. Restoring it would silently drop
    // history, so refuse rather than write a truncated day.
    if (rows.length !== meta.counts[table]) {
      throw new Error(
        `Backup looks incomplete (${table}: found ${rows.length} of ${meta.counts[table]}). Nothing was changed.`
      );
    }
    restored[table] = rows;
  }

  const snapshot = restored as unknown as LocalSnapshot;
  await importSnapshot(snapshot);
  return snapshot;
}

/** Removes the account's backup entirely. Local data is untouched. */
export async function deleteBackup(uid: string): Promise<void> {
  const db = cloudDb();
  for (const table of TABLES) {
    const existing = await getDocs(chunksRef(uid, table));
    const batch = writeBatch(db);
    for (const d of existing.docs) batch.delete(d.ref);
    await batch.commit();
  }
  await deleteDoc(userRoot(uid));
}
