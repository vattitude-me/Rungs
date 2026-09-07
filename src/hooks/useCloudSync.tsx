import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { cloudConfigured } from '../cloud/config';
import type { CloudAccount } from '../cloud/auth';
import type { SyncDirection, SyncState } from '../cloud/autosync';

const authModule = () => import('../cloud/auth');
const syncModule = () => import('../cloud/sync');
const autoModule = () => import('../cloud/autosync');

interface CloudContext {
  /** Null when signed out, undefined until auth has reported in. */
  account: CloudAccount | null | undefined;
  state: SyncState;
  /** Set when both this device and the cloud hold unsynced work. */
  conflict: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Resolve a conflict by choosing which side wins. */
  resolve: (keep: 'local' | 'cloud') => Promise<void>;
  syncNow: () => Promise<void>;
}

const Ctx = createContext<CloudContext | null>(null);

const IDLE: SyncState = { status: 'idle', lastSyncedAt: 0 };

export function CloudSyncProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<CloudAccount | null | undefined>(
    cloudConfigured ? undefined : null
  );
  const [state, setState] = useState<SyncState>(IDLE);
  const [conflict, setConflict] = useState(false);
  // Guards against two syncs overlapping - a debounced upload firing while the
  // sign-in sync is still running would race on the same documents.
  const running = useRef(false);

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

  /** One sync pass: work out which way data should move, then move it. */
  const sync = useCallback(async (uid: string) => {
    if (running.current) return;
    running.current = true;
    setState({ status: 'syncing' });
    try {
      const [auto, cloud] = await Promise.all([autoModule(), syncModule()]);
      const [hasData, remote] = await Promise.all([
        auto.localHasData(),
        cloud.fetchBackupMeta(uid),
      ]);
      const direction: SyncDirection = auto.decideDirection({
        localHasData: hasData,
        localDirty: auto.hasUnsyncedChanges(),
        remote,
        lastSyncedAt: auto.lastSyncedAt(),
        syncedGeneration: auto.syncedGeneration(),
      });

      if (direction === 'conflict') { setConflict(true); setState(IDLE); return; }
      if (direction === 'push') {
        // Stamped before the upload, so a set logged while it was in flight
        // still counts as unsynced and gets picked up by the next pass.
        const startedAt = Date.now();
        const meta = await cloud.pushBackup(uid, __APP_VERSION__, { force: true });
        auto.markSynced(startedAt);
        auto.markGeneration(meta.updatedAt);
        setState({ status: 'idle', lastSyncedAt: meta.updatedAt });
        return;
      }
      if (direction === 'pull') {
        await cloud.pullBackup(uid);
        auto.markSynced();
        // Remember which backup we now match, so the next pass doesn't read it
        // as a stranger's and pull it again in a loop.
        if (remote) auto.markGeneration(remote.updatedAt);
        // Restored rows replace what the running app already read into memory,
        // so the screens have to be rebuilt from the new database.
        window.location.reload();
        return;
      }
      setState({ status: 'idle', lastSyncedAt: auto.lastSyncedAt() });
    } catch (e) {
      setState(
        typeof navigator !== 'undefined' && !navigator.onLine
          ? { status: 'offline' }
          : { status: 'error', message: (e as Error).message }
      );
    } finally {
      running.current = false;
    }
  }, []);

  // Sync on sign-in, and whenever the account changes.
  useEffect(() => {
    if (!account) return;
    void sync(account.uid);
  }, [account, sync]);

  // Sync after the user stops writing, and when the app is backgrounded - the
  // last chance to save a session on mobile, where tabs are killed silently.
  useEffect(() => {
    if (!account || conflict) return;
    let stopSchedule: (() => void) | undefined;
    void autoModule().then((auto) => {
      stopSchedule = auto.scheduleOnChange(() => void sync(account.uid));
    });

    const onHide = () => {
      if (document.visibilityState === 'hidden') void sync(account.uid);
    };
    document.addEventListener('visibilitychange', onHide);
    return () => {
      stopSchedule?.();
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [account, conflict, sync]);

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
    // The next account must not inherit this one's sync clock, or its first
    // pass would misread whose data is newer.
    auto.resetChangeMarks();
    setConflict(false);
    setState(IDLE);
  }, []);

  const resolve = useCallback(async (keep: 'local' | 'cloud') => {
    if (!account) return;
    setConflict(false);
    setState({ status: 'syncing' });
    try {
      const [auto, cloud] = await Promise.all([autoModule(), syncModule()]);
      if (keep === 'local') {
        const startedAt = Date.now();
        const meta = await cloud.pushBackup(account.uid, __APP_VERSION__, { force: true });
        auto.markSynced(startedAt);
        auto.markGeneration(meta.updatedAt);
        setState({ status: 'idle', lastSyncedAt: meta.updatedAt });
      } else {
        const remote = await cloud.fetchBackupMeta(account.uid);
        await cloud.pullBackup(account.uid);
        auto.markSynced();
        if (remote) auto.markGeneration(remote.updatedAt);
        window.location.reload();
      }
    } catch (e) {
      setState({ status: 'error', message: (e as Error).message });
    }
  }, [account]);

  const syncNow = useCallback(async () => {
    if (account) await sync(account.uid);
  }, [account, sync]);

  return (
    <Ctx.Provider value={{ account, state, conflict, signIn, signOut, resolve, syncNow }}>
      {children}
    </Ctx.Provider>
  );
}

export function useCloudSync(): CloudContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCloudSync must be used inside CloudSyncProvider');
  return ctx;
}
