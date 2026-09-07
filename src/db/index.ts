import Dexie, { type Table } from 'dexie';
import type {
  Profile, BaselineLog, DayPlan, SetLog, DayRecord, AppSettings, StreakData,
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
};

const DEFAULT_STREAK: StreakData = {
  id: SINGLETON_ID,
  current: 0,
  longest: 0,
  lastActiveDate: '',
  graceDaysUsedInWindow: 0,
  windowStartDate: '',
};

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
  const profile = await db.profile.toCollection().first();
  return profile ? migrateProfile(profile) : undefined;
}

export async function saveProfile(profile: Profile): Promise<void> {
  await db.profile.put(profile);
  markChanged();
}

export async function getBaselineLogs(): Promise<BaselineLog[]> {
  return db.baselineLogs.orderBy('testedAt').toArray();
}

export async function saveBaselineLog(log: BaselineLog): Promise<void> {
  await db.baselineLogs.put(log);
  markChanged();
}

export async function getDayPlan(date: string): Promise<DayPlan | undefined> {
  return db.dayPlans.where('date').equals(date).first();
}

export async function saveDayPlan(plan: DayPlan): Promise<void> {
  await db.dayPlans.put(plan);
  markChanged();
}

export async function getSetLogs(date: string): Promise<SetLog[]> {
  return db.setLogs.where('date').equals(date).toArray();
}

export async function getAllSetLogs(): Promise<SetLog[]> {
  return db.setLogs.toArray();
}

export async function saveSetLog(log: SetLog): Promise<void> {
  await db.setLogs.put(log);
  markChanged();
}

export async function getDayRecord(date: string): Promise<DayRecord | undefined> {
  return db.dayRecords.get(date);
}

export async function saveDayRecord(record: DayRecord): Promise<void> {
  await db.dayRecords.put(record);
  markChanged();
}

export async function getAllDayRecords(): Promise<DayRecord[]> {
  return db.dayRecords.toArray();
}

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get(SINGLETON_ID);
  return s ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  await db.settings.put({ ...settings, id: SINGLETON_ID });
  markChanged();
}

export async function getStreak(): Promise<StreakData> {
  const s = await db.streaks.get(SINGLETON_ID);
  return s ?? DEFAULT_STREAK;
}

export async function saveStreak(streak: StreakData): Promise<void> {
  await db.streaks.put({ ...streak, id: SINGLETON_ID });
  markChanged();
}

/** Everything this install holds, in one plain object - the unit that gets
 * backed up and restored. Table names match the Dexie tables exactly so a
 * restore can write each one back without a mapping step. */
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
  return { profile, baselineLogs, dayPlans, setLogs, dayRecords, settings, streaks };
}

/** Replaces every table with the snapshot's contents, in one transaction so a
 * failure part-way can't leave half of one backup stitched onto half of
 * another. Restore is deliberately a replace rather than a merge: merging two
 * divergent histories would have to invent an answer for derived values like
 * the streak, and silently getting that wrong is worse than being told the
 * local copy is about to be overwritten. */
export async function importSnapshot(snapshot: LocalSnapshot): Promise<void> {
  await db.transaction('rw', [
    db.profile, db.baselineLogs, db.dayPlans, db.setLogs,
    db.dayRecords, db.settings, db.streaks,
  ], async () => {
    await Promise.all([
      db.profile.clear(), db.baselineLogs.clear(), db.dayPlans.clear(),
      db.setLogs.clear(), db.dayRecords.clear(), db.settings.clear(), db.streaks.clear(),
    ]);
    await Promise.all([
      db.profile.bulkPut(snapshot.profile ?? []),
      db.baselineLogs.bulkPut(snapshot.baselineLogs ?? []),
      db.dayPlans.bulkPut(snapshot.dayPlans ?? []),
      db.setLogs.bulkPut(snapshot.setLogs ?? []),
      db.dayRecords.bulkPut(snapshot.dayRecords ?? []),
      db.settings.bulkPut(snapshot.settings ?? []),
      db.streaks.bulkPut(snapshot.streaks ?? []),
    ]);
  });
}

export async function resetAllData(): Promise<void> {
  // db.delete() issues indexedDB.deleteDatabase(), which blocks until every
  // open connection closes. The singleton `db` above is still open on this
  // page, so without closing it first the delete request never resolves
  // (or resolves after a reload has already raced ahead and reopened it),
  // leaving stale data in place while the UI thinks it succeeded.
  db.close();
  await db.delete();
  // Drop the sync clock too. Left behind, it would tell the next sign-in that
  // this device has unsynced work, and a device with no data claiming to be
  // dirty is exactly the state that reads as a conflict.
  resetChangeMarks();
}
