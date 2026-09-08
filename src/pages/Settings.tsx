import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, Timer, Vibrate, Bell, Lock, Info, ChevronDown, Clock, Minus, Plus, Gauge,
  UserPlus, Users, Sparkles, Cloud, Camera, Watch, Trophy,
} from 'lucide-react';
import Button from '../components/Button';
import Toggle from '../components/Toggle';
import ListRow from '../components/ListRow';
import { getProfile, saveProfile, getSettings, saveSettings, getDayPlan } from '../db';
import {
  isNative, requestNotificationPermission, hasNotificationPermission,
  scheduleWindowReminders, cancelWindowReminders,
} from '../engine/notifications';
import { installPlatform } from '../engine/install';
import { generateDayPlan, rebuildTodayWindows } from '../engine/planGenerator';
import { localDate, dayIndexFor, daysBetweenDates } from '../engine/dates';
import { shouldRebaseline } from '../engine/coach';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';
import type { Profile, AppSettings } from '../types';

type NotifState = 'granted' | 'denied' | 'unsupported';

const MIN_WINDOWS = 2;
const MAX_WINDOWS = 6;

/** Fallback schedule for a profile saved before window times were stored. */
const FALLBACK_TIMES = ['10:00', '13:00', '16:00', '19:00'];

/** Spreads `count` windows evenly between 09:00 and 19:00, used when the user
 * adds or removes a window rather than editing one by hand. */
function evenTimes(count: number): string[] {
  const start = 9 * 60;
  const end = 19 * 60;
  const step = count > 1 ? (end - start) / (count - 1) : 0;
  return Array.from({ length: count }, (_, i) => {
    const m = Math.round(start + step * i);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  });
}

const UPCOMING_FEATURES = [
  { icon: UserPlus, title: 'Friends', subtitle: 'Add friends, see their streaks' },
  { icon: Users, title: 'Squad', subtitle: 'Group feed, leaderboards' },
  { icon: Sparkles, title: 'Motivational nudges', subtitle: 'Playful, max two a day' },
  { icon: Camera, title: 'Camera auto-count', subtitle: 'Pose detection counts reps for you' },
  { icon: Watch, title: 'Watch app', subtitle: 'Log sets from your wrist' },
  { icon: Trophy, title: 'Challenges', subtitle: 'Timed group challenges' },
] as const;

export default function Settings() {
  const navigate = useNavigate();
  const { account } = useCloudSync();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [upcomingOpen, setUpcomingOpen] = useState(false);
  // Whether this browser can receive pushed reminders, and whether iOS is
  // holding it back until the app is installed to the Home Screen.
  const [pushReady, setPushReady] = useState(false);
  const [needsInstall, setNeedsInstall] = useState(false);
  // Whether this device actually has a push token on the account. Null until
  // known. Distinct from the reminders setting: the setting is what the user
  // asked for, this is whether the server can honour it.
  const [pushRegistered, setPushRegistered] = useState<boolean | null>(null);
  const [editingWindow, setEditingWindow] = useState<number | null>(null);
  const [windowDraft, setWindowDraft] = useState('');
  const [notifPermission, setNotifPermission] = useState<NotifState>(
    isNative() || 'Notification' in window ? 'denied' : 'unsupported'
  );

  useEffect(() => {
    getProfile().then((p) => setProfile(p ?? null));
    getSettings().then(setSettings);
    hasNotificationPermission().then((granted) => {
      setNotifPermission((prev) => (prev === 'unsupported' ? prev : granted ? 'granted' : 'denied'));
    });
  }, []);

  useEffect(() => {
    if (isNative()) return;
    void import('../cloud/push').then(async (push) => {
      setPushReady(await push.pushSupported());
      setNeedsInstall(push.needsHomeScreenInstall());
    });
  }, []);

  // Registering only inside the toggle was not enough. The four things push
  // needs - reminders on, signed in, installed, permission granted - are each
  // switched on from a different place and in any order, and whichever came
  // last was the only one with a chance to register. Someone who had
  // reminders on before they installed, or before they signed in, would never
  // toggle again and so never get a token: the app looked entirely correct
  // and the server had nowhere to send.
  //
  // So reconcile instead of relying on an event. Whenever all four hold and
  // this device has no token, get one.
  useEffect(() => {
    if (isNative()) return;
    if (!account || !settings?.reminders) return;
    if (notifPermission !== 'granted') return;
    let cancelled = false;
    void (async () => {
      const push = await import('../cloud/push');
      if (cancelled || !(await push.pushSupported())) return;
      const ok = await push.registerPush(account.uid).catch((e: unknown) => {
        console.error('[rungs] push registration failed:', e);
        return false;
      });
      if (!cancelled) setPushRegistered(ok);
    })();
    return () => { cancelled = true; };
  }, [account, settings?.reminders, notifPermission]);

  // Every hook must run before this point. An early return sitting above a
  // useEffect makes the hook count change the moment the data lands, which is
  // React error #310 - and the first render here is always the empty one.
  if (!profile || !settings) return null;

  const initial = (profile.name.trim()[0] || 'A').toUpperCase();
  const windowTimes = profile.windowTimes?.length ? profile.windowTimes : FALLBACK_TIMES;
  const today = localDate();
  const testedOn = profile.lastRebaselineAt || localDate(new Date(profile.createdAt));
  const daysSinceTest = daysBetweenDates(testedOn, today);
  const retestDue = shouldRebaseline(profile.lastRebaselineAt, today, localDate(new Date(profile.createdAt)));
  const lastTestedLabel = daysSinceTest <= 0 ? 'today' : daysSinceTest === 1 ? 'yesterday' : `${daysSinceTest} days ago`;

  // What "install" is called on the platform in front of the user. iPhones add
  // to the Home Screen, Macs add to the Dock, and everyone else installs -
  // telling a desktop user to find their Home Screen would send them looking
  // for a menu that isn't there.
  const platform = installPlatform(false);
  const installVerb =
    platform === 'ios' ? 'Add to your Home Screen'
    : platform === 'macos-safari' ? 'Add to your Dock'
    : 'Install the app';

  const saveName = async () => {
    const n = nameDraft.trim().slice(0, 24);
    const next = { ...profile, name: n || profile.name };
    setProfile(next);
    await saveProfile(next);
    setEditingName(false);
  };

  /** Persists a new schedule and re-cuts what's left of today onto it, so the
   * change is visible now rather than only tomorrow. */
  const applyWindowTimes = async (times: string[]) => {
    if (!profile) return;
    const sorted = [...times].sort((a, b) => a.localeCompare(b));
    const next = { ...profile, windowTimes: sorted, windowCount: sorted.length };
    setProfile(next);
    await saveProfile(next);

    const today = localDate();
    const plan = await getDayPlan(today);
    if (!plan) return;
    // Rebuilt windows get fresh ids, so drop the reminders keyed to the old
    // ones before they're orphaned, then re-arm from the new schedule.
    await cancelWindowReminders(plan);
    const rebuilt = await rebuildTodayWindows(plan, next, sorted);
    // `next`, not `profile` - reminders now project future days from the
    // profile, and those days must use the schedule just saved.
    if (settings?.reminders) await scheduleWindowReminders(rebuilt, next);
  };

  const setWindowCount = async (count: number) => {
    if (count < MIN_WINDOWS || count > MAX_WINDOWS) return;
    await applyWindowTimes(evenTimes(count));
  };

  const saveWindowTime = async () => {
    if (editingWindow === null || !windowDraft) { setEditingWindow(null); return; }
    const next = [...windowTimes];
    next[editingWindow] = windowDraft;
    setEditingWindow(null);
    await applyWindowTimes(next);
  };

  const updateSetting = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const toggleReminders = async () => {
    const turningOn = !settings.reminders;

    if (turningOn) {
      if (notifPermission === 'unsupported') return;
      if (notifPermission !== 'granted') {
        const granted = await requestNotificationPermission();
        setNotifPermission(granted ? 'granted' : 'denied');
        if (!granted) return;
      }
    }

    await updateSetting({ reminders: turningOn });

    // In a browser the app can't schedule anything that survives the tab
    // closing, so a signed-in web user gets reminders pushed from the server
    // instead. Native builds schedule locally and need none of this.
    if (account) {
      const push = await import('../cloud/push');
      if (await push.pushSupported()) {
        if (turningOn) {
          // Surfaced, not swallowed: a token that fails to register is the
          // difference between getting reminders and silently never getting
          // them, and the user has just asked for them by name.
          const ok = await push.registerPush(account.uid).catch((e: unknown) => {
            console.error('[rungs] push registration failed:', e);
            return false;
          });
          setPushRegistered(ok);
        } else {
          await push.unregisterPush(account.uid);
          setPushRegistered(false);
        }
      }
    }

    // Push the change to the OS scheduler straight away rather than waiting for
    // the next poll, so the toggle feels like it did something.
    if (!profile) return;
    const today = localDate();
    const plan = await generateDayPlan(today, dayIndexFor(profile.createdAt, today), profile);
    if (turningOn) await scheduleWindowReminders(plan, profile);
    else await cancelWindowReminders(plan);
  };

  return (
    <div className="flex-1 h-full overflow-y-auto flex flex-col px-5 pt-4 pb-24 gap-3.75">
      <div className="flex items-center gap-3.25">
        <span className="w-13 h-13 flex-none rounded-2xl bg-accent-800 grid place-items-center text-[19px] font-medium text-accent-100">
          {initial}
        </span>
        {!editingName ? (
          <span className="flex-1 flex items-center gap-2.5">
            <span className="flex-1 flex flex-col gap-px">
              <span className="text-[17px] font-medium">{profile.name}</span>
              <span className="text-[11.5px] text-neutral-500">This phone only</span>
            </span>
            <Button
              variant="secondary" className="h-8.5 px-3.5 text-xs flex-none"
              onClick={() => { setNameDraft(profile.name); setEditingName(true); }}
            >
              Edit
            </Button>
          </span>
        ) : (
          <span className="flex-1 flex flex-col gap-1.75">
            <span className="flex items-center gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditingName(false); }}
                placeholder="Your name"
                maxLength={24}
                className="flex-1 h-9.5 px-2.5 rounded-lg bg-surface border border-neutral-800 text-sm text-text outline-none focus-visible:border-accent"
              />
              <Button variant="primary" className="h-9.5 px-3.5 flex-none" onClick={saveName}>Save</Button>
            </span>
            <span className="text-[11px] text-neutral-600">Stays on this phone. Used in greetings only.</span>
          </span>
        )}
      </div>

      <div className="flex-none rounded-[14px] bg-surface shadow-sm overflow-hidden">
        <button
          onClick={() => setUpcomingOpen((v) => !v)}
          className="w-full flex items-center gap-2.5 px-3.5 py-3 cursor-pointer text-left"
        >
          <span className="flex-1 flex flex-col gap-px">
            <span className="text-[13.5px] font-medium">Upcoming features</span>
            <span className="text-[11px] text-neutral-600">What's planned, not built yet</span>
          </span>
          <ChevronDown
            size={15}
            className="text-neutral-500 transition-transform duration-200"
            style={{ transform: upcomingOpen ? 'rotate(180deg)' : 'none' }}
          />
        </button>
        {upcomingOpen && (
          <div className="border-t border-neutral-800/60">
            {UPCOMING_FEATURES.map((f) => (
              <ListRow key={f.title} icon={<f.icon size={14} />} title={f.title} subtitle={f.subtitle} />
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.75">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">STRENGTH</span>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst
            icon={<Gauge size={14} />}
            title="Retest your maxes"
            subtitle={
              retestDue
                ? `Due now · last tested ${lastTestedLabel}`
                : `${profile.maxes.push} push · ${profile.maxes.pull} pull · ${profile.maxes.squat} squat`
            }
            trailing={<span className="text-[13px] text-neutral-600">›</span>}
            onClick={() => navigate('/settings/retest')}
          />
        </div>
        {retestDue && (
          <span className="text-[11px] leading-[1.5] text-neutral-600 px-0.5">
            Your plan still sizes sets from these numbers. If they're out of
            date the day gets harder or easier than it should be.
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.75">
        <div className="flex items-baseline justify-between px-0.5">
          <span className="text-[11px] tracking-[0.1em] text-neutral-500">SCHEDULE</span>
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] text-neutral-500">
              {windowTimes.length} a day
            </span>
            <button
              type="button"
              aria-label="One less window"
              disabled={windowTimes.length <= MIN_WINDOWS}
              onClick={() => setWindowCount(windowTimes.length - 1)}
              className="w-6.5 h-6.5 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Minus size={13} />
            </button>
            <button
              type="button"
              aria-label="One more window"
              disabled={windowTimes.length >= MAX_WINDOWS}
              onClick={() => setWindowCount(windowTimes.length + 1)}
              className="w-6.5 h-6.5 rounded-full bg-surface grid place-items-center text-neutral-300 cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed"
            >
              <Plus size={13} />
            </button>
          </div>
        </div>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          {windowTimes.map((t, i) => (
            <div key={i}>
              <ListRow
                isFirst={i === 0}
                icon={<Clock size={14} />}
                title={t}
                subtitle={i === 0 ? 'First window of the day' : i === windowTimes.length - 1 ? 'Last chance to catch up' : 'Tap to change'}
                trailing={<span className="text-[13px] text-neutral-600">›</span>}
                onClick={() => { setEditingWindow(i); setWindowDraft(t); }}
              />
              {editingWindow === i && (
                <div className="flex items-center gap-2.5 px-3.5 py-3 bg-accent-900">
                  <input
                    type="time"
                    value={windowDraft}
                    onChange={(e) => setWindowDraft(e.target.value)}
                    className="flex-1 h-9 px-2.5 rounded-lg bg-surface border border-neutral-800 text-sm text-text outline-none focus-visible:border-accent"
                  />
                  <Button variant="secondary" className="h-9 px-3 text-xs flex-none" onClick={() => setEditingWindow(null)}>Cancel</Button>
                  <Button variant="primary" className="h-9 px-3 text-xs flex-none" onClick={saveWindowTime}>Save</Button>
                </div>
              )}
            </div>
          ))}
        </div>
        <span className="text-[11px] leading-[1.5] text-neutral-600 px-0.5">
          Your daily reps are split across these times. Anything you've already
          finished today stays done - only what's left gets re-cut.
        </span>
      </div>

      <div className="flex flex-col gap-1.75">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">COUNTER</span>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst icon={<Mic size={14} />} title="Voice count" subtitle="Says every rep out loud"
            trailing={<Toggle size="dense" on={settings.voice} onToggle={() => updateSetting({ voice: !settings.voice })} />}
          />
          <ListRow
            icon={<Timer size={14} />} title="Metronome ticks" subtitle="Down / up cue tones"
            trailing={<Toggle size="dense" on={settings.ticks} onToggle={() => updateSetting({ ticks: !settings.ticks })} />}
          />
          <ListRow
            icon={<Vibrate size={14} />} title="Haptics" subtitle="A pulse per rep"
            trailing={<Toggle size="dense" on={settings.haptics} onToggle={() => updateSetting({ haptics: !settings.haptics })} />}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.75">
        <span className="text-[11px] tracking-[0.1em] text-neutral-500">REMINDERS</span>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst icon={<Bell size={14} />} title="Window reminders"
            subtitle={
              notifPermission === 'unsupported'
                ? 'Not supported in this browser'
                : notifPermission === 'denied'
                  ? isNative()
                    ? 'Blocked, enable in Android settings'
                    : 'Blocked, enable in browser settings'
                  : isNative()
                    ? '5 minutes before each window'
                    // In a browser nothing of the app runs once the tab is
                    // closed, so reminders only survive that if they're pushed
                    // from the server - which needs an account.
                    // Registered is the only state that actually earns the
                    // plain promise - the rest have a caveat the user needs.
                    : account && pushReady && pushRegistered === false
                      ? 'Could not register this device for reminders'
                    : account && pushReady
                      ? '5 minutes before each window'
                      : needsInstall
                        ? `${installVerb} first, then sign in`
                        : account
                          ? '5 minutes before each window, while the app is open'
                          : 'Sign in to get reminders while the app is closed'
            }
            trailing={
              <Toggle
                size="dense"
                on={settings.reminders && notifPermission === 'granted'}
                onToggle={toggleReminders}
              />
            }
          />
          {cloudConfigured && (
            <ListRow icon={<Cloud size={14} />} title="Account & sync" subtitle="Backs up as you go, restores on a new device" trailing={<span className="text-[13px] text-neutral-600">›</span>} onClick={() => navigate('/settings/sync')} />
          )}
          <ListRow icon={<Lock size={14} />} title="Data & privacy" subtitle={cloudConfigured ? 'What\u2019s stored, and where' : 'On-device only, nothing shared'} trailing={<span className="text-[13px] text-neutral-600">›</span>} onClick={() => navigate('/settings/privacy')} />
          <ListRow icon={<Info size={14} />} title="About Rungs" subtitle={`v${__APP_VERSION__} · free forever`} trailing={<span className="text-[13px] text-neutral-600">›</span>} />
        </div>
      </div>

      <div className="text-[11.5px] leading-[1.5] text-neutral-600 text-center pt-1">
        Rungs is free forever. No ads, no paywall,<br />no locked exercises.
      </div>
    </div>
  );
}
