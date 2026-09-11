import { CloudUpload, CloudOff, RefreshCw, TriangleAlert, Check } from 'lucide-react';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';

/**
 * The sync control in the Today header - shown only when sync needs the user.
 *
 * Signed out it's an invitation, but a small one: sync is worth offering and
 * not worth a banner across the top of the screen every day until it's
 * dismissed.
 *
 * Signed in and healthy it renders nothing. Syncing already happens on open,
 * on return, on reconnect and after each set, so a permanent green tick was
 * reporting the absence of news - it asked for a corner of the header every
 * day to say the thing the user already assumes. Account details and a manual
 * refresh live in Settings, one tap away via the Profile tab, for the rarer
 * moment of wanting to watch a change land from another device.
 *
 * Offline and error are the exceptions and still show. Those are the states
 * where the user's assumption ("my reps are saved") has quietly stopped being
 * true, and staying silent about them is what makes the silence untrustworthy
 * everywhere else.
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

  // Healthy and idle is the one state with nothing to say. Syncing still shows
  // so a sync the user triggered from Settings has visible progress rather than
  // appearing to do nothing.
  if (state.status === 'idle') return null;

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
