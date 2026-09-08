import { CloudUpload, CloudOff, RefreshCw, TriangleAlert, Check } from 'lucide-react';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';

/**
 * The account control in the Today header.
 *
 * Signed out it's an invitation, but a small one - sync is worth offering and
 * not worth a banner across the top of the screen every day until it's
 * dismissed. Sitting beside the settings button it stays available forever
 * without ever being in the way, which is what a dismissable banner was
 * really trying to buy: a way to stop seeing it.
 *
 * Signed in it becomes status plus a manual refresh. Syncing already happens
 * on open, on return, on reconnect and after each set; the tap is for the
 * moment the user has just changed something on another device and wants to
 * see it land now rather than trust that it will.
 */
export default function CloudButton() {
  const { account, state, signIn, syncNow } = useCloudSync();

  if (!cloudConfigured || account === undefined) return null;

  if (!account) {
    return (
      <button
        type="button"
        onClick={() => void signIn()}
        disabled={state.status === 'syncing'}
        aria-label="Sync to a cloud account"
        title="Sync your reps across devices"
        className="w-9.5 h-9.5 flex-none rounded-full bg-accent-800 grid place-items-center text-accent-100 cursor-pointer disabled:opacity-60"
      >
        <CloudUpload size={18} strokeWidth={1.8} className={state.status === 'syncing' ? 'animate-pulse' : ''} />
      </button>
    );
  }

  const busy = state.status === 'syncing';
  const Icon =
    busy ? RefreshCw
    : state.status === 'offline' ? CloudOff
    : state.status === 'error' ? TriangleAlert
    : Check;

  const label =
    busy ? 'Syncing'
    : state.status === 'offline' ? 'Offline · syncs when you reconnect'
    : state.status === 'error' ? state.message
    : 'Synced · tap to refresh';

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={busy}
      aria-label={label}
      title={label}
      className={`w-9.5 h-9.5 flex-none rounded-full bg-surface grid place-items-center cursor-pointer disabled:opacity-100 ${
        state.status === 'error' ? 'text-danger' : 'text-neutral-400'
      }`}
    >
      <Icon size={16} strokeWidth={1.9} className={busy ? 'animate-spin' : ''} />
    </button>
  );
}
