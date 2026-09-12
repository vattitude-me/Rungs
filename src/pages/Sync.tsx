import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ChevronLeft, LogOut, Trash2, ShieldCheck, RefreshCw, UserX, ArrowRight } from 'lucide-react';
import Button from '../components/Button';
import ListRow from '../components/ListRow';
import { getProfile } from '../db';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';
import type { BackupMeta } from '../cloud/sync';

const syncModule = () => import('../cloud/sync');

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
  const location = useLocation();
  // Reached from the welcome splash, "back" means the splash - not history,
  // which may be empty on a cold start.
  const fromWelcome = (location.state as { from?: string } | null)?.from === 'welcome';

  const { account, state, signIn, disconnect, syncNow } = useCloudSync();
  const [meta, setMeta] = useState<BackupMeta | null>(null);
  // Whether this device has a usable profile yet. A restore creates one, so
  // this is what separates "signed in, ready to train" from "signed in
  // part-way through setting up".
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Re-read after each pass settles, not during one. A restore writes the
  // profile part-way through the pass, so a read taken while syncing can
  // legitimately find nothing and then never look again - which is what put
  // "Set up my plan" in front of someone who had just restored an account that
  // already had one.
  useEffect(() => {
    if (state.status === 'syncing') return;
    let cancelled = false;
    getProfile().then((p) => {
      if (!cancelled) setHasProfile(Boolean(p?.onboardingComplete));
    });
  }, [account, state]);

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
  }, [account, state, refreshMeta]);

  const handleDeleteBackup = async () => {
    if (!account) return;
    setBusy(true); setError(null); setNote(null);
    try {
      const { deleteBackup } = await syncModule();
      await deleteBackup(account.uid);
      setMeta(null);
      setNote('Cloud copy deleted. Nothing on this device changed.');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-6 gap-4">
      <div className="flex items-center gap-3">
        <Button
          variant="icon"
          onClick={() => {
            // Back into onboarding is the wrong destination once there's a
            // profile to use - a restore is exactly the case where the splash
            // behind you is no longer where you belong.
            if (hasProfile) navigate('/today', { replace: true });
            else if (fromWelcome) navigate('/onboarding/welcome');
            else navigate(-1);
          }}
        >
          <ChevronLeft size={18} />
        </Button>
        <div className="text-[15px] font-medium">Account</div>
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
              {account ? 'Signed in' : 'Keep your history safe'}
            </div>
            <div className="text-[13.5px] leading-[1.5] text-neutral-400">
              {account
                ? 'Your reps sync on their own as you log them. Use Rungs on any device and they all stay in step — the most recent change always wins.'
                : 'Sign in and your reps sync as you go. Use another phone and everything is already there — name, schedule and streak included.'}
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

          {account === undefined ? null : !account ? (
            <Button
              variant="primary" block className="h-12 text-[15px]"
              disabled={state.status === 'syncing'}
              onClick={() => void signIn()}
            >
              {state.status === 'syncing' ? 'Opening sign-in…' : 'Continue with Google'}
            </Button>
          ) : (
            <>
              <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
                <ListRow
                  isFirst icon={<ShieldCheck size={14} />}
                  title={account.email ?? account.displayName ?? 'Signed in'}
                  subtitle={
                    // An empty backup is worth saying plainly. "Last saved 1h
                    // ago - 0 sets across 0 days" reads as though something is
                    // safely stored when nothing is, which is the one thing a
                    // backup screen must never imply.
                    !meta ? 'Nothing backed up yet'
                    : (meta.counts.setLogs ?? 0) === 0 && (meta.counts.dayRecords ?? 0) === 0
                      ? 'Signed in · nothing to back up yet'
                      : `Last saved ${describeWhen(meta.updatedAt)} · ${countReps(meta)}`
                  }
                />
                <ListRow
                  icon={<RefreshCw size={14} />}
                  title="Sync now"
                  subtitle={
                    state.status === 'syncing' ? 'Saving…'
                    : state.status === 'offline' ? 'Offline — will save when you reconnect'
                    : state.status === 'error' ? state.message
                    : 'Happens automatically; this forces it'
                  }
                  onClick={state.status === 'syncing' ? undefined : () => void syncNow()}
                  trailing={<span className="text-[13px] text-neutral-600">›</span>}
                />
              </div>

              {/* The way out. Without this the only exit is the back chevron,
                  which from the welcome splash leads back to onboarding - a
                  dead end for someone who just restored their history and
                  wants to start training. */}
              {/* Until a pass has settled there is no answer yet, and guessing
                  "new user" is the costly guess: it offers to build a plan
                  over an account that already has one. */}
              {state.status === 'syncing' ? (
                <div className="text-[12.5px] text-neutral-400 text-center py-3">
                  Checking your account…
                </div>
              ) : hasProfile === true ? (
                <Button
                  variant="primary" block className="h-12 text-[15px]"
                  onClick={() => navigate('/today', { replace: true })}
                >
                  <span className="inline-flex items-center gap-2">
                    Go to today
                    <ArrowRight size={16} />
                  </span>
                </Button>
              ) : hasProfile === false ? (
                <Button
                  variant="primary" block className="h-12 text-[15px]"
                  onClick={() => navigate('/onboarding/name', { replace: true })}
                >
                  <span className="inline-flex items-center gap-2">
                    Set up my plan
                    <ArrowRight size={16} />
                  </span>
                </Button>
              ) : null}

              <div className="flex flex-col gap-1.75 mt-1">
                <span className="text-[11px] tracking-[0.1em] text-neutral-500">ACCOUNT</span>
                <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
                  <ListRow
                    isFirst icon={<LogOut size={14} />} title="Disconnect this device"
                    subtitle="Stops syncing here. Your data stays on this device and in the cloud"
                    onClick={busy ? undefined : () => void disconnect()}
                    trailing={<span className="text-[13px] text-neutral-600">›</span>}
                  />
                  {meta && (
                    <ListRow
                      icon={<Trash2 size={14} />} title="Delete cloud copy"
                      subtitle="Removes what's stored online, keeps this device's data"
                      onClick={busy ? undefined : () => void handleDeleteBackup()}
                      trailing={<span className="text-[13px] text-neutral-600">›</span>}
                    />
                  )}
                  <ListRow
                    icon={<UserX size={14} />} title="Delete account"
                    subtitle="Erases everything, everywhere — on Data & privacy"
                    onClick={() => navigate('/settings/privacy')}
                    trailing={<span className="text-[13px] text-neutral-600">›</span>}
                  />
                </div>
              </div>

              <div className="text-[11.5px] leading-[1.5] text-neutral-500">
                Your data is stored under your Google account and readable only
                by you. Rungs still works entirely offline; anything you log
                syncs up once you're back on a connection, and the most recent
                version of each entry is the one that's kept.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
