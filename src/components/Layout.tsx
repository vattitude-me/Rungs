import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, LineChart, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';

/** The tabs either side of the log button. Two on the left, two on the right,
 * so the action button stays centred. */
const LEFT_TABS = [
  { path: '/today', label: 'Home', Icon: Home },
  { path: '/progress', label: 'Progress', Icon: LineChart },
] as const;

const RIGHT_TABS = [
  { path: '/squad', label: 'Squad', Icon: Users },
] as const;

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const pending = usePendingSquadCount();

  const tab = ({ path, label, Icon }: { path: string; label: string; Icon: typeof Home }) => {
    const active = location.pathname === path;
    const badge = path === '/squad' ? pending : 0;
    return (
      <button
        key={path}
        onClick={() => navigate(path)}
        className="flex-1 flex flex-col items-center gap-[3px] cursor-pointer"
        style={{ color: active ? '#d2cefd' : '#75798c' }}
      >
        <span className="relative">
          <Icon size={18} strokeWidth={2} />
          {badge > 0 && (
            <span
              aria-label={`${badge} waiting`}
              className="absolute -top-1 -right-1.5 min-w-3.5 h-3.5 px-1 rounded-full grid place-items-center text-[8.5px] font-semibold tabular-nums"
              style={{ background: '#e0806f', color: '#161826' }}
            >
              {badge > 9 ? '9+' : badge}
            </span>
          )}
        </span>
        <span className="text-[9.5px] tracking-[0.02em]">{label}</span>
      </button>
    );
  };

  return (
    <div className="relative flex flex-col h-full">
      <main key={location.pathname} className="route-tab flex-1 overflow-y-auto">
        <Outlet />
      </main>
      <nav
        className="absolute left-0 right-0 bottom-0 h-[84px] px-3.5 pb-5 flex items-center justify-between safe-bottom"
        style={{
          background: 'linear-gradient(to top, rgba(22,24,38,.98) 55%, rgba(22,24,38,0))',
          backdropFilter: 'blur(8px)',
        }}
      >
        {LEFT_TABS.map(tab)}

        <button
          onClick={() => navigate('/session/log')}
          aria-label="Log reps"
          className="flex-none w-15 h-15 -mt-6 rounded-full bg-accent grid place-items-center cursor-pointer shadow-lg"
          style={{ boxShadow: '0 6px 20px rgba(145,132,217,.45)' }}
        >
          <Plus size={26} strokeWidth={2.5} color="#161826" />
        </button>

        {RIGHT_TABS.map(tab)}
        {/* Balances the two tabs on the left so the action button sits in the
            middle rather than drifting right. */}
        <span className="flex-1" aria-hidden />
      </nav>
    </div>
  );
}

/** How many friend requests and unread nudges are waiting.
 *
 * Lives here rather than in Squad because the point of it is to be visible
 * from the other tabs - a nudge nobody is told about is a nudge that does
 * nothing. Watches the same inbox Squad does; Firestore serves both listeners
 * from one connection.
 */
function usePendingSquadCount(): number {
  const { account } = useCloudSync();
  const [count, setCount] = useState(0);
  const uid = account?.uid;

  useEffect(() => {
    if (!cloudConfigured || !uid) {
      setCount(0);
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import('../cloud/friends').then((m) => {
      if (cancelled) return;
      stop = m.watchInbox(uid, (items) => setCount(items.length));
    });
    return () => { cancelled = true; stop?.(); };
  }, [uid]);

  return count;
}
