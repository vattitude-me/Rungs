import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, CloudUpload, CloudDownload, LogOut, Trash2, ShieldCheck } from 'lucide-react';
import Button from '../components/Button';
import ListRow from '../components/ListRow';
import { cloudConfigured } from '../cloud/config';
import type { CloudAccount } from '../cloud/auth';
import type { BackupMeta } from '../cloud/sync';

// The Firebase SDK is ~500 KB and only this screen needs it, so it's pulled in
// on demand rather than shipped in the bundle every user downloads to open
// Today. Type-only imports above are erased at build time and cost nothing.
const authModule = () => import('../cloud/auth');
const syncModule = () => import('../cloud/sync');

type Busy = 'push' | 'pull' | 'signin' | 'delete' | null;

function describeWhen(ms: number): string {
  if (!ms) return 'never';
  const mins = Math.floor((Date.now() - ms) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

function countReps(meta: BackupMeta): string {
  const sets = meta.counts.setLogs ?? 0;
  const days = meta.counts.dayRecords ?? 0;
  return `${sets} set${sets === 1 ? '' : 's'} across ${days} day${days === 1 ? '' : 's'}`;
}

export default function Sync() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<CloudAccount | null>(null);
  const [ready, setReady] = useState(false);
  const [meta, setMeta] = useState<BackupMeta | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);

  useEffect(() => {
    if (!cloudConfigured) { setReady(true); return; }
    let stop: (() => void) | undefined;
    let cancelled = false;
    void authModule().then(async (m) => {
      // A native sign-in comes back through a redirect, so this load may be the
      // return leg; failures are surfaced but don't block the page.
      await m.resumeSignIn().catch((e: Error) => setError(e.message));
      if (cancelled) return;
      stop = m.watchAccount((next) => { setAccount(next); setReady(true); });
    });
    return () => { cancelled = true; stop?.(); };
  }, []);

  const refreshMeta = useCallback(async (uid: string) => {
    try {
      const { fetchBackupMeta } = await syncModule();
      setMeta(await fetchBackupMeta(uid));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (account) void refreshMeta(account.uid);
    else setMeta(null);
  }, [account, refreshMeta]);

  const run = async (kind: Busy, fn: () => Promise<void>) => {
    setBusy(kind); setError(null); setNote(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const handleBackup = () => run('push', async () => {
    if (!account) return;
    const { pushBackup } = await syncModule();
    const next = await pushBackup(account.uid, __APP_VERSION__);
    setMeta(next);
    setNote('Backed up.');
  });

  const handleRestore = () => run('pull', async () => {
    if (!account) return;
    const { pullBackup } = await syncModule();
    await pullBackup(account.uid);
    setConfirmRestore(false);
    // Restored rows replace everything the running app has already read into
    // memory, so reload rather than navigate - the same reason a full reset does.
    window.location.href = window.location.origin + window.location.pathname;
  });

  const handleDeleteBackup = () => run('delete', async () => {
    if (!account) return;
    const { deleteBackup } = await syncModule();
    await deleteBackup(account.uid);
    setMeta(null);
    setNote('Cloud backup deleted. Nothing on this device changed.');
  });

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-6 gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <div className="text-[15px] font-medium">Cloud backup</div>
      </div>

      {!cloudConfigured ? (
        <div className="flex flex-col gap-1.5">
          <div className="text-[22px] font-medium tracking-[-0.02em]">Not available in this build</div>
          <div className="text-[13.5px] leading-[1.5] text-neutral-400">
            This copy of Rungs was built without cloud credentials, so there's
            nothing to sign in to. Everything stays on this device.
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <div className="text-[22px] font-medium tracking-[-0.02em]">
              {account ? 'Your history, saved off this phone' : 'Keep your history safe'}
            </div>
            <div className="text-[13.5px] leading-[1.5] text-neutral-400">
              {account
                ? 'Back up when you want a copy, restore to move to a new device. Nothing uploads on its own.'
                : 'Sign in to store a copy of your reps, streak and settings, so a lost phone doesn’t mean starting over.'}
            </div>
          </div>

          {error && (
            <div className="px-3.5 py-3 rounded-[13px] bg-danger/12 border border-danger/40 text-[12.5px] leading-[1.5] text-danger">
              {error}
            </div>
          )}
          {note && !error && (
            <div className="px-3.5 py-3 rounded-[13px] bg-accent-900 text-[12.5px] leading-[1.5] text-accent-200">
              {note}
            </div>
          )}

          {!ready ? null : !account ? (
            <Button
              variant="primary" block className="h-12 text-[15px]"
              disabled={busy === 'signin'}
              onClick={() => run('signin', async () => { await (await authModule()).signIn(); })}
            >
              {busy === 'signin' ? 'Opening sign-in…' : 'Sign in with Google'}
            </Button>
          ) : (
            <>
              <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
                <ListRow
                  isFirst icon={<ShieldCheck size={14} />}
                  title={account.email ?? account.displayName ?? 'Signed in'}
                  subtitle={meta
                    ? `Last backup ${describeWhen(meta.updatedAt)} · ${countReps(meta)}`
                    : 'No backup on this account yet'}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Button
                  variant="primary" block className="h-12 text-[15px]"
                  disabled={busy !== null}
                  onClick={handleBackup}
                >
                  <span className="inline-flex items-center gap-2">
                    <CloudUpload size={16} />
                    {busy === 'push' ? 'Backing up…' : 'Back up now'}
                  </span>
                </Button>

                {meta && !confirmRestore && (
                  <Button
                    variant="secondary" block className="h-12 text-[15px]"
                    disabled={busy !== null}
                    onClick={() => { setConfirmRestore(true); setError(null); setNote(null); }}
                  >
                    <span className="inline-flex items-center gap-2">
                      <CloudDownload size={16} />
                      Restore from backup
                    </span>
                  </Button>
                )}

                {meta && confirmRestore && (
                  <div className="flex flex-col gap-2.5 px-3.5 py-3.5 rounded-[13px] bg-surface shadow-sm">
                    <div className="text-[12.5px] leading-[1.5] text-neutral-400">
                      This replaces everything on this device with the backup from{' '}
                      <span className="text-text font-medium">{describeWhen(meta.updatedAt)}</span>{' '}
                      ({countReps(meta)}). Anything logged here since then is lost.
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="secondary" className="flex-1"
                        disabled={busy !== null}
                        onClick={() => setConfirmRestore(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="danger" className="flex-1"
                        disabled={busy !== null}
                        onClick={handleRestore}
                      >
                        {busy === 'pull' ? 'Restoring…' : 'Replace my data'}
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-1.75 mt-1">
                <span className="text-[11px] tracking-[0.1em] text-neutral-500">ACCOUNT</span>
                <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
                  <ListRow
                    isFirst icon={<LogOut size={14} />} title="Sign out"
                    subtitle="Your data stays on this device"
                    onClick={busy ? undefined : () => run('signin', async () => {
                      await (await authModule()).signOut();
                    })}
                    trailing={<span className="text-[13px] text-neutral-600">›</span>}
                  />
                  {meta && (
                    <ListRow
                      icon={<Trash2 size={14} />} title="Delete cloud backup"
                      subtitle="Removes the copy stored online, keeps this device's data"
                      onClick={busy ? undefined : handleDeleteBackup}
                      trailing={<span className="text-[13px] text-neutral-600">›</span>}
                    />
                  )}
                </div>
              </div>

              <div className="text-[11.5px] leading-[1.5] text-neutral-500">
                Backups are stored under your Google account and readable only by
                you. Rungs still works entirely offline; this is a copy, not a
                requirement.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
