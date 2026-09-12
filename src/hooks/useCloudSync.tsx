import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cloudConfigured } from '../cloud/config';
import type { CloudAccount } from '../cloud/auth';
import type { SyncState } from '../cloud/autosync';

const authModule = () => import('../cloud/auth');
const syncModule = () => import('../cloud/sync');
const autoModule = () => import('../cloud/autosync');

interface CloudContext {
  /** Null when signed out, undefined until auth has reported in. */
  account: CloudAccount | null | undefined;
  state: SyncState;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  syncNow: () => Promise<void>;
  /** Disconnect this device from the account, leaving the cloud copy intact. */
  disconnect: () => Promise<void>;
  /** Erase the cloud copy and the Google account link. Local data is the
   * caller's to handle. */
  deleteAccount: () => Promise<void>;
}

const Ctx = createContext<CloudContext | null>(null);

const IDLE: SyncState = { status: 'idle', lastSyncedAt: 0 };

/** Why the last profile publish failed, or null if it worked.
 *
 * Module-level rather than React state because the publish runs inside the
 * sync pass, which is deliberately outside the component tree. Squad reads it
 * when its own profile load comes back empty, to tell "not published yet"
 * from "published fine, still loading".
 */
let lastPublishError: string | null = null;

export function sharedProfileError(): string | null {
  return lastPublishError;
}

/** What the last sync pass actually did. Diagnostic only; nothing reads it to
 * make a decision. */
export interface SyncReport {
  uid: string;
  /** Whether the cursor was reset because the account changed. */
  switched: boolean;
  cursorBefore: number;
  pulled: number;
  pushed: number;
  at: number;
}

let lastSyncReport: SyncReport | null = null;

export function syncReport(): SyncReport | null {
  return lastSyncReport;
}

/** Publishes the handful of figures a friend is allowed to see.
 *
 * Everything here is recomputed from the local tables rather than passed in,
 * so the number a friend sees is the same one the user's own Today screen
 * draws - percent of the day's tier, from the same set logs.
 *
 * Never throws, because this is a courtesy write for a side tab and the backup
 * has already succeeded by the time it runs - failing it must not report that
 * the user's data didn't save. But it no longer fails *silently*: without the
 * profile there is no invite code, and Squad showed that as a permanent row of
 * dots with nothing to act on.
 */
async function publishSharedProfile(uid: string): Promise<void> {
  try {
    const [{ getProfile, getSetLogs, getDayPlan, getStreak }, dates, friends] = await Promise.all([
      import('../db'),
      import('../engine/dates'),
      import('../cloud/friends'),
    ]);

    const profile = await getProfile();
    if (!profile?.onboardingComplete) return;

    const today = dates.localDate();
    const [logs, plan, streak] = await Promise.all([
      getSetLogs(today), getDayPlan(today), getStreak(),
    ]);

    const done = logs.reduce((sum, log) => sum + log.reps, 0);
    const goal = plan?.tier ?? profile.tier ?? 100;
    const percent = goal > 0 ? (100 * done) / goal : 0;

    await friends.publishProfile(uid, profile.name, percent, streak.current, today);
  } catch (e) {
    // Non-fatal for sync itself - a workout backs up fine whether or not the
    // shareable profile went out. But swallowing it entirely is what made a
    // missing invite code look like a permanent row of dots in Squad with
    // nothing to act on, so the reason is kept for Squad to surface.
    lastPublishError = (e as Error).message;
    return;
  }
  lastPublishError = null;
}


/** How close together two automatic sync passes may run. Returning to the app
 * should refresh it, but tabbing away and back a few times shouldn't cost a
 * round trip each time. Short enough that "open the app and it's current"
 * still holds; long enough that flicking between tabs is free. */
const RESUME_MIN_GAP_MS = 10_000;

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<CloudAccount | null | undefined>(
    cloudConfigured ? undefined : null
  );
  const [state, setState] = useState<SyncState>(IDLE);
  // Guards against two syncs overlapping - a debounced pass firing while the
  // sign-in sync is still running would race on the same documents.
  const running = useRef(false);
  // Set while an account is being deleted. A debounced sync landing between
  // "delete the backup" and "delete the account" would quietly recreate the
  // data the user just asked us to destroy.
  const deleting = useRef(false);
  // When the last pass finished, so returning to the app repeatedly doesn't
  // fire one every time. Tabbing away and back is a normal thing to do; it
  // shouldn't cost a round trip each time.
  const lastPassAt = useRef(0);
  // Whether the next pass is the first for this account. The sign-in pass
  // restores rather than updates, and is handled by re-reading instead of by
  // reloading - see the reload below.
  const firstPassForAccount = useRef(true);

  useEffect(() => {
    if (!cloudConfigured) return;
    let stop: (() => void) | undefined;
    let cancelled = false;
    void authModule().then(async (m) => {
      await m.resumeSignIn().catch(() => undefined);
      if (cancelled) return;
      stop = m.watchAccount((next) => setAccount(next));
    });
    return () => { cancelled = true; stop?.(); };
  }, []);

  /** One sync pass. There is no direction to decide: every pass merges the
   * cloud's newer rows in and sends this device's newer rows out, and the
   * later stamp wins wherever the two hold the same row. */
  const sync = useCallback(async (uid: string, opts: { force?: boolean } = {}) => {
    if (running.current || deleting.current) return;
    // A pass that just ran has nothing new to say. Skipped only for the
    // automatic triggers - an explicit "sync now" always goes through, because
    // the user asking is itself the reason to check.
    if (!opts.force && Date.now() - lastPassAt.current < RESUME_MIN_GAP_MS) return;
    running.current = true;
    setState({ status: 'syncing' });
    try {
      const [auto, cloud] = await Promise.all([autoModule(), syncModule()]);

      // Before reading the cursor, not after: the stored position belongs to
      // whichever account was last synced on this device, and signing straight
      // from one account into another (without the sign-out that used to clear
      // it) would otherwise ask the new account for records newer than the old
      // account's position. Every one of its records is older than that, so
      // the pull matches nothing, the pass reports a clean empty sync, and the
      // device uploads its own state over a history it never read.
      const switched = auto.adoptAccount(uid);

      const startedAt = Date.now();
      const cursorBefore = auto.pullCursor();
      const result = await cloud.syncRecords(
        uid, __APP_VERSION__, cursorBefore, auto.pushWatermark()
      );
      // Kept deliberately, not left over from debugging. A sync that silently
      // does nothing is the one failure this code cannot explain after the
      // fact - the counts it writes describe the device, so an empty device
      // and a refused read look identical afterwards. One line per pass is a
      // cost worth paying to be able to answer "what did it actually read".
      lastSyncReport = {
        uid, switched, cursorBefore,
        pulled: result.pulled, pushed: result.pushed, at: startedAt,
      };
      auto.markPulled(result.cursor);
      auto.markPushed(result.watermark);
      auto.markSynced(startedAt);
      setState({ status: 'idle', lastSyncedAt: startedAt });

      // Refresh the small public document friends read. Deliberately after the
      // sync rather than inside it: it shares no data the sync doesn't already
      // hold, and a failure here - rules, offline, a first run before the
      // profile exists - must not mark the backup itself as failed.
      void publishSharedProfile(uid);

      // Merged rows replace what the running app already read into memory, so
      // the screens have to be rebuilt from the new database. Only when the
      // merge actually changed something: reloading on every pass would throw
      // the user out of a session they're part-way through.
      //
      // Not on the pass that follows sign-in, though. A fresh install signing
      // in to an existing account merges its whole history here, and reloading
      // on that is both the slowest possible way to show it and, in a
      // Capacitor WebView, not reliably a reload at all - which is what left
      // the app sitting on onboarding with the restored profile already in the
      // database underneath it. ProfileWatcher re-reads on the account
      // changing, so that case is already covered without a reload.
      if (result.changed && !firstPassForAccount.current) window.location.reload();
      firstPassForAccount.current = false;
    } catch (e) {
      setState(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? { status: 'offline' }
          : { status: 'error', message: (e as Error).message }
      );
    } finally {
      lastPassAt.current = Date.now();
      running.current = false;
    }
  }, []);

  // Sync on sign-in, and whenever the account changes. Forced: signing in is
  // the moment a device most needs to be current, and it must not be skipped
  // because some other trigger happened to fire a moment earlier.
  useEffect(() => {
    if (!account) return;
    firstPassForAccount.current = true;
    void sync(account.uid, { force: true });
  }, [account, sync]);

  // Everything that should trigger a sync pass.
  //
  // The one worth calling out is coming *back* to the app. A tab or app left
  // open for a week is still signed in and still showing what it read when it
  // was opened - which may be days behind what the user has since done on
  // their phone. Syncing only after they write would mean logging a set
  // against stale state, and deleting one elsewhere would appear not to have
  // worked. Refreshing on the way in is what makes "pick up any device" true
  // rather than "true within six seconds of typing".
  useEffect(() => {
    if (!account) return;
    let stopSchedule: (() => void) | undefined;
    void autoModule().then((auto) => {
      stopSchedule = auto.scheduleOnChange(() => void sync(account.uid));
    });

    const onVisibility = () => {
      // Going away is forced: on mobile this is the last code that runs before
      // the tab is killed, so a throttle here could lose a whole session.
      // Coming back is throttled, because flicking between tabs is normal and
      // shouldn't cost a round trip each time.
      const leaving = document.visibilityState === 'hidden';
      void sync(account.uid, { force: leaving });
    };
    // Reconnecting is the other moment a device is knowingly behind: whatever
    // it failed to send while offline goes out, and whatever it missed
    // arrives.
    const onOnline = () => void sync(account.uid);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      stopSchedule?.();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [account, sync]);

  const signIn = useCallback(async () => {
    setState({ status: 'syncing' });
    try {
      await (await authModule()).signIn();
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
    }
  }, []);

  const signOut = useCallback(async () => {
    const [auth, auto] = await Promise.all([authModule(), autoModule()]);
    await auth.signOut();
    // The next account must not inherit this one's read position, or its first
    // pass would skip the history it's signing in to get.
    auto.resetChangeMarks();
    setState(IDLE);
  }, []);

  const syncNow = useCallback(async () => {
    if (account) await sync(account.uid, { force: true });
  }, [account, sync]);

  /** Signs out and forgets the sync clock, but leaves the cloud copy alone -
   * the user is stepping off this device, not giving up their history. */
  const disconnect = useCallback(async () => {
    const [auth, auto] = await Promise.all([authModule(), autoModule()]);
    await auth.signOut();
    auto.resetChangeMarks();
    setState(IDLE);
  }, []);

  /** Removes everything Rungs holds for this account, cloud-side.
   *
   * Order matters: the Firestore documents are deleted while the user is still
   * authenticated, because the security rules only permit a user to delete
   * their own data - dropping the auth account first would strand the backup
   * with no one able to reach it. */
  const deleteAccountFully = useCallback(async () => {
    if (!account) return;
    deleting.current = true;
    setState({ status: 'syncing' });
    try {
      const [auth, cloud, auto, friends] = await Promise.all([
        authModule(), syncModule(), autoModule(), import('../cloud/friends'),
      ]);
      // Before the backup, because this reaches outside the user's own subtree
      // - the public profile, the invite code, and the far side of every
      // friendship. Those are the parts nobody else can clean up afterwards,
      // and they must go while the user is still authenticated.
      await friends.deleteFriendData(account.uid);
      await cloud.deleteBackup(account.uid);
      await auth.deleteAccount();
      auto.resetChangeMarks();
      setState(IDLE);
    } finally {
      deleting.current = false;
    }
  }, [account]);

  return (
    <Ctx.Provider value={{
      account, state, signIn, signOut, syncNow,
      disconnect, deleteAccount: deleteAccountFully,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCloudSync(): CloudContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCloudSync must be used inside CloudSyncProvider');
  return ctx;
}
