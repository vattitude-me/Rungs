import Dexie, { type Table } from 'dexie';
import type {
  Profile, BaselineLog, DayPlan, SetLog, DayRecord, AppSettings, StreakData, Synced,
} from '../types';
import { markChanged, resetChangeMarks } from './changes';

class RungsDB extends Dexie {
  profile!: Table<Profile, string>;
  baselineLogs!: Table<BaselineLog, string>;
  dayPlans!: Table<DayPlan, string>;
  setLogs!: Table<SetLog, string>;
  dayRecords!: Table<DayRecord, string>;
  settings!: Table<AppSettings, string>;
  streaks!: Table<StreakData, string>;

  constructor() {
    // DO NOT RENAME. This is the IndexedDB database name, invisible to users
    // and unrelated to the app's display name. Changing it orphans every
    // existing install's data (profile, baselines, set logs, streaks) with no
    // migration path.
    super('hundred');
    this.version(1).stores({
      profile: 'id',
      baselineLogs: 'id, exercise, testedAt',
      dayPlans: 'id, date',
      setLogs: 'id, date, exercise, completedAt',
      dayRecords: 'date',
      settings: 'defaultTempo',
      streaks: 'current',
    });

    // v1 keyed settings/streaks by a value field (defaultTempo / current), so
    // every save whose value changed inserted a new row instead of
    // overwriting - put() decides insert-vs-update by primary key. Reads did
    // `.toCollection().first()` with no defined order, so the streak/settings
    // shown could jump between stale rows. v2 keys both by a fixed 'id' and
    // collapses any duplicate rows an affected install accumulated, keeping
    // the streak with the highest `current` and the last-written settings row.
    this.version(2).stores({
      profile: 'id',
      baselineLogs: 'id, exercise, testedAt',
      dayPlans: 'id, date',
      setLogs: 'id, date, exercise, completedAt',
      dayRecords: 'date',
      settings: 'id',
      streaks: 'id',
    }).upgrade(async (tx) => {
      const settingsRows = await tx.table('settings').toArray();
      await tx.table('settings').clear();
      const lastSettings = settingsRows[settingsRows.length - 1];
      if (lastSettings) await tx.table('settings').put({ ...lastSettings, id: 'singleton' });

      const streakRows = await tx.table('streaks').toArray();
      await tx.table('streaks').clear();
      const bestStreak = streakRows.reduce<typeof streakRows[number] | undefined>(
        (best, row) => (!best || row.current > best.current ? row : best),
        undefined
      );
      if (bestStreak) await tx.table('streaks').put({ ...bestStreak, id: 'singleton' });
    });

    // v3 adds per-row sync stamps. `updatedAt` is indexed because every push
    // asks the same question - which rows changed since the last one - and
    // scanning every set log to answer it would get slower with each month of
    // training. Existing rows are stamped from whatever time they already
    // carry, so a merge orders them roughly as they actually happened rather
    // than declaring the entire history to have been written at upgrade time.
    this.version(3).stores({
      profile: 'id, updatedAt',
      baselineLogs: 'id, exercise, testedAt, updatedAt',
      dayPlans: 'id, date, updatedAt',
      setLogs: 'id, date, exercise, completedAt, updatedAt',
      dayRecords: 'date, updatedAt',
      settings: 'id, updatedAt',
      streaks: 'id, updatedAt',
    }).upgrade(async (tx) => {
      const stamp = async (name: string, at: (row: Record<string, unknown>) => number) => {
        const rows = await tx.table(name).toArray();
        await tx.table(name).bulkPut(
          rows.map((row) => ({ ...row, updatedAt: row.updatedAt ?? at(row) }))
        );
      };
      const asNumber = (v: unknown, fallback: number) =>
        typeof v === 'number' && Number.isFinite(v) ? v : fallback;
      // Dates are YYYY-MM-DD; parsed as UTC midnight they order correctly
      // relative to each other, which is all the merge needs from them.
      const fromDate = (v: unknown) => {
        const t = typeof v === 'string' ? Date.parse(v) : NaN;
        return Number.isNaN(t) ? 0 : t;
      };
      await stamp('profile', (r) => asNumber(r.createdAt, 0));
      await stamp('baselineLogs', (r) => asNumber(r.testedAt, 0));
      await stamp('dayPlans', (r) => fromDate(r.date));
      await stamp('setLogs', (r) => asNumber(r.completedAt, fromDate(r.date)));
      await stamp('dayRecords', (r) => fromDate(r.date));
      // The two singletons carry no time of their own. Stamping them `now`
      // makes this device's copy the winner on first merge, which is right:
      // they're settings and a derived streak, and the device the user is
      // holding is the one whose version they last saw.
      await stamp('settings', () => Date.now());
      await stamp('streaks', () => Date.now());
    });
  }
}

export const db = new RungsDB();

const SINGLETON_ID = 'singleton';

const DEFAULT_SETTINGS: AppSettings = {
  id: SINGLETON_ID,
  counterVariant: 'cadenceRing',
  dashboardVariant: 'rings',
  voice: true,
  ticks: true,
  haptics: true,
  reminders: false,
  nudges: false,
  waitlistSquad: false,
  defaultTempo: 2.5,
  updatedAt: 0,
};

const DEFAULT_STREAK: StreakData = {
  id: SINGLETON_ID,
  current: 0,
  longest: 0,
  lastActiveDate: '',
  graceDaysUsedInWindow: 0,
  windowStartDate: '',
  updatedAt: 0,
};

/** Stamps a row as written now. Every save goes through this, so no code path
 * can write a row that a merge would then treat as older than it is. */
function stamped<T extends Synced>(row: T): T {
  return { ...row, updatedAt: Date.now() };
}

/** True when a row is a tombstone - deleted on some device, kept only so the
 * delete can travel to the others. Reads filter these out, so the rest of the
 * app never sees one. */
function isDeleted(row: Synced | undefined): boolean {
  return Boolean(row?.deletedAt);
}

function live<T extends Synced>(rows: T[]): T[] {
  return rows.filter((r) => !isDeleted(r));
}

/** Fills in fields added after a profile was first written, so an install from
 * before the tier model doesn't come back with an undefined tier and render a
 * NaN goal. */
function migrateProfile(profile: Profile): Profile {
  if (profile.tier && profile.tierStartedAt) return profile;
  const createdDate = new Date(profile.createdAt || Date.now());
  const iso = createdDate.toISOString().slice(0, 10);
  return {
    ...profile,
    tier: profile.tier ?? 100,
    tierStartedAt: profile.tierStartedAt || iso,
  };
}

export async function getProfile(): Promise<Profile | undefined> {
  const profile = live(await db.profile.toArray())[0];
  return profile ? migrateProfile(profile) : undefined;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put(stamped(profile));
  markChanged();
}

export async function getBaselineLogs(): Promise<BaselineLog[]> {
  return live(await db.baselineLogs.orderBy('testedAt').toArray());
}

export async function saveBaselineLog(log: BaselineLog): Promise<void> {
  await db.baselineLogs.put(stamped(log));
  markChanged();
}

export async function getDayPlan(date: string): Promise<DayPlan | undefined> {
  return live(await db.dayPlans.where('date').equals(date).toArray())[0];
}

export async function saveDayPlan(plan: DayPlan): Promise<void> {
  await db.dayPlans.put(stamped(plan));
  markChanged();
}

export async function getSetLogs(date: string): Promise<SetLog[]> {
  return live(await db.setLogs.where('date').equals(date).toArray());
}

export async function getAllSetLogs(): Promise<SetLog[]> {
  return live(await db.setLogs.toArray());
}

export async function saveSetLog(log: SetLog): Promise<void> {
  await db.setLogs.put(stamped(log));
  markChanged();
}

/** Removes a logged set on every device.
 *
 * The row is kept as a tombstone rather than dropped, because a row that
 * simply vanished here is indistinguishable, to the next merge, from one this
 * device has never seen - and the merge would put it back. The stamp is what
 * makes the delete win over the older version another device still holds. */
export async function deleteSetLog(id: string): Promise<void> {
  const existing = await db.setLogs.get(id);
  if (!existing) return;
  const at = Date.now();
  await db.setLogs.put({ ...existing, updatedAt: at, deletedAt: at });
  markChanged();
}

export async function getDayRecord(date: string): Promise<DayRecord | undefined> {
  const record = await db.dayRecords.get(date);
  return isDeleted(record) ? undefined : record;
}

export async function saveDayRecord(record: DayRecord): Promise<void> {
  await db.dayRecords.put(stamped(record));
  markChanged();
}

export async function getAllDayRecords(): Promise<DayRecord[]> {
  return live(await db.dayRecords.toArray());
}

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get(SINGLETON_ID);
  return s && !isDeleted(s) ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put(stamped({ ...settings, id: SINGLETON_ID }));
  markChanged();
}

export async function getStreak(): Promise<StreakData> {
  const s = await db.streaks.get(SINGLETON_ID);
  return s && !isDeleted(s) ? s : DEFAULT_STREAK;
}

export async function saveStreak(streak: StreakData): Promise<void> {
  await db.streaks.put(stamped({ ...streak, id: SINGLETON_ID }));
  markChanged();
}

/** The tables that sync, and the field each one uses as its primary key.
 *
 * Sync is deliberately table-generic - it merges rows by (table, id) without
 * caring what shape they are - so this is the one place that has to know that
 * `dayRecords` is keyed by date while everything else is keyed by id. */
export const SYNCED_TABLES = {
  profile: 'id',
  baselineLogs: 'id',
  dayPlans: 'id',
  setLogs: 'id',
  dayRecords: 'date',
  settings: 'id',
  streaks: 'id',
} as const;

export type SyncedTable = keyof typeof SYNCED_TABLES;

export const TABLE_NAMES = Object.keys(SYNCED_TABLES) as SyncedTable[];

/** One row on its way to or from the cloud, with enough identity attached to
 * be merged back into the right table without consulting its shape. */
export interface SyncRecord {
  table: SyncedTable;
  id: string;
  updatedAt: number;
  deletedAt?: number;
  row: Record<string, unknown>;
}

/** Rows are stored untyped in Firestore and merged by key alone, so this is
 * the boundary where the specific row types are set aside. The Dexie tables
 * put them back on the way in. */
function tableOf(name: SyncedTable): Table<Synced, string> {
  return db[name] as unknown as Table<Synced, string>;
}

export function recordId(table: SyncedTable, row: Record<string, unknown>): string {
  return String(row[SYNCED_TABLES[table]]);
}

/** Every local row written after `since`, as records ready to upload.
 *
 * The bound is exclusive: `since` is a stamp this device has already uploaded,
 * so including it would re-send the same row on every quiet sync forever. A
 * row written in the same millisecond as the last push is the one thing this
 * misses, and it can't be missed for long - the row is still in the table, and
 * the next write to it, or a sign-out and back in, sends it. Trading that
 * against a permanent upload on every pass is the right way round.
 *
 * Pass 0 to get everything, which is what a device syncing an account for the
 * first time needs. */
export async function changedSince(since: number): Promise<SyncRecord[]> {
  const out: SyncRecord[] = [];
  for (const table of TABLE_NAMES) {
    const rows = since > 0
      ? await tableOf(table).where('updatedAt').above(since).toArray()
      : await tableOf(table).toArray();
    for (const row of rows) {
      const plain = row as unknown as Record<string, unknown>;
      // Every stored row is stamped - by `save*` on the way in, or by the v3
      // upgrade for rows that predate stamping. A row without one would still
      // be pushed here, so it's treated as the oldest possible write rather
      // than skipped: it loses every merge, which is the safe way to be wrong
      // about a row whose age we genuinely don't know.
      const updatedAt = row.updatedAt ?? 0;
      out.push({
        table,
        id: recordId(table, plain),
        updatedAt,
        ...(row.deletedAt ? { deletedAt: row.deletedAt } : {}),
        row: { ...plain, updatedAt },
      });
    }
  }
  return out;
}

/** How many rows a table holds that aren't tombstones. Used for the cloud's
 * status line, which should say what the user actually has rather than
 * counting the delete markers alongside it. */
export async function liveCount(table: SyncedTable): Promise<number> {
  return tableOf(table).filter((row) => !row.deletedAt).count();
}

/** Merges records pulled from the cloud into the local tables.
 *
 * This is the whole of the sync model: for any row two devices both hold, the
 * copy stamped later is the one that survives. Nothing else is consulted -
 * not which device wrote it, not which direction the data is moving - so the
 * result is the same no matter what order devices sync in, and a device that
 * merges the same batch twice ends up exactly where it did the first time.
 *
 * Ties are broken on the rows' contents rather than left to arrival order. Two
 * devices writing the same row in the same millisecond is vanishingly rare,
 * but "rare, resolved arbitrarily" means the two devices can disagree forever,
 * each having kept whichever copy happened to reach it second. Comparing the
 * rows themselves gives both the same answer without another round trip.
 *
 * Returns the number of rows that actually changed, so the caller can tell a
 * pull that brought news from one that brought back what we already had.
 */
export async function mergeRecords(records: SyncRecord[]): Promise<number> {
  if (records.length === 0) return 0;

  const byTable = new Map<SyncedTable, SyncRecord[]>();
  for (const record of records) {
    const list = byTable.get(record.table);
    if (list) list.push(record);
    else byTable.set(record.table, [record]);
  }

  let applied = 0;
  await db.transaction('rw', TABLE_NAMES.map((t) => tableOf(t)), async () => {
    for (const [table, incoming] of byTable) {
      const store = tableOf(table);
      const existing = await store.bulkGet(incoming.map((r) => r.id));
      const wins: Synced[] = [];
      for (const [i, record] of incoming.entries()) {
        const mine = existing[i];
        if (mine && !newerThan(record, mine)) continue;
        wins.push(record.row as unknown as Synced);
      }
      if (wins.length > 0) {
        await store.bulkPut(wins);
        applied += wins.length;
      }
    }
  });
  return applied;
}

/** Whether an incoming record should replace the local row it collides with.
 *
 * The tie-breakers below only ever run when two writes share a millisecond,
 * and they exist for one reason: both devices must reach the *same* verdict.
 * Anything that depends on which copy arrived first would leave the two
 * permanently disagreeing, with no later write to settle it. */
function newerThan(incoming: SyncRecord, mine: Synced): boolean {
  const theirs = incoming.updatedAt;
  const ours = mine.updatedAt ?? 0;
  if (theirs !== ours) return theirs > ours;

  // Deleting wins a tie: when the stamps can't separate them, resurrecting a
  // row the user removed is the more surprising of the two outcomes.
  const theirsDeleted = Boolean(incoming.deletedAt);
  const oursDeleted = Boolean(mine.deletedAt);
  if (theirsDeleted !== oursDeleted) return theirsDeleted;

  // Same instant, same delete state: compare the rows themselves. The id is no
  // use here - a collision means both copies carry the same one - so this
  // orders on content, which is the only thing that still differs. Equal
  // content makes the choice moot, and `>` correctly keeps what's already
  // stored.
  return stableKey(incoming.row) > stableKey(mine as unknown as Record<string, unknown>);
}

/** A row rendered as a string that doesn't depend on key insertion order, so
 * two devices that built the same row by different code paths still compare
 * as equal. */
function stableKey(row: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(row).sort().map((k) => [k, row[k]])
  );
}

/** Everything this install holds, in one plain object. Kept for the local
 * export on the privacy screen; sync itself works record-by-record. */
export interface LocalSnapshot {
  profile: Profile[];
  baselineLogs: BaselineLog[];
  dayPlans: DayPlan[];
  setLogs: SetLog[];
  dayRecords: DayRecord[];
  settings: AppSettings[];
  streaks: StreakData[];
}

export async function exportSnapshot(): Promise<LocalSnapshot> {
  const [profile, baselineLogs, dayPlans, setLogs, dayRecords, settings, streaks] =
    await Promise.all([
      db.profile.toArray(),
      db.baselineLogs.toArray(),
      db.dayPlans.toArray(),
      db.setLogs.toArray(),
      db.dayRecords.toArray(),
      db.settings.toArray(),
      db.streaks.toArray(),
    ]);
  return {
    profile: live(profile),
    baselineLogs: live(baselineLogs),
    dayPlans: live(dayPlans),
    setLogs: live(setLogs),
    dayRecords: live(dayRecords),
    settings: live(settings),
    streaks: live(streaks),
  };
}

/** True when this install holds anything worth keeping. A profile alone
 * counts: someone who finished onboarding and logged nothing still has their
 * name, baseline and schedule. */
export async function hasLocalData(): Promise<boolean> {
  const [profile, setLogs, dayRecords] = await Promise.all([
    db.profile.count(), db.setLogs.count(), db.dayRecords.count(),
  ]);
  return profile > 0 || setLogs > 0 || dayRecords > 0;
}

export async function resetAllData(): Promise<void> {
  // db.delete() issues indexedDB.deleteDatabase(), which blocks until every
  // open connection closes. The singleton `db` above is still open on this
  // page, so without closing it first the delete request never resolves
  // (or resolves after a reload has already raced ahead and reopened it),
  // leaving stale data in place while the UI thinks it succeeded.
  db.close();
  await db.delete();
  // Drop the read cursor too. Left behind, it would tell the next sign-in that
  // this now-empty device had already read the account, and the merge would
  // skip exactly the history the user is signing in to get back.
  resetChangeMarks();
}
