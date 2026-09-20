import { useState } from 'react';
import { CloudUpload, CloudOff, RefreshCw, TriangleAlert, Check, X } from 'lucide-react';
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
  const [showing, setShowing] = useState(false);

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

  // `title` is a hover tooltip, and there is no hover on a phone - so on the
  // one platform this app mainly ships to, the error state was a red triangle
  // that explained nothing and whose only action was to retry the thing that
  // had just failed. Tapping an error now opens the message instead.
  const isError = state.status === 'error';

  return (
    <>
      <button
        type="button"
        onClick={() => (isError ? setShowing(true) : void syncNow())}
        disabled={busy}
        aria-label={label}
        title={label}
        className={`w-9.5 h-9.5 flex-none rounded-full bg-surface grid place-items-center cursor-pointer disabled:opacity-100 ${
          isError ? 'text-danger' : 'text-neutral-400'
        }`}
      >
        <Icon size={16} strokeWidth={1.9} className={busy ? 'animate-spin' : ''} />
      </button>

      {showing && isError && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center"
          style={{ background: 'rgba(0,0,0,.55)' }}
          onClick={() => setShowing(false)}
        >
          <div
            className="w-full max-w-[420px] rounded-t-[20px] bg-surface p-5 pb-8 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-medium">Sync problem</span>
              <button
                onClick={() => setShowing(false)}
                aria-label="Close"
                className="w-8 h-8 rounded-full grid place-items-center text-neutral-500 cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            <div className="text-[13px] leading-[1.55] text-neutral-300">{state.message}</div>

            <div className="text-[11.5px] leading-[1.5] text-neutral-500">
              Your reps are safe on this phone either way. Don't uninstall or
              sign out while this is showing - that's the one thing that would
              lose anything not yet uploaded.
            </div>

            <button
              onClick={() => { setShowing(false); void syncNow(); }}
              className="h-11 rounded-xl bg-accent text-[14px] font-medium cursor-pointer"
              style={{ color: '#161826' }}
            >
              Try again
            </button>
          </div>
        </div>
      )}
    </>
  );
}
