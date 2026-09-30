import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, Timer, Vibrate, Bell, Lock, Info, ChevronDown, Gauge, Dumbbell,
  Sparkles, Cloud, Camera, Watch, Trophy,
} from 'lucide-react';
import Button from '../components/Button';
import Toggle from '../components/Toggle';
import ListRow from '../components/ListRow';
import ModeChip from '../components/ModeChip';
import ThemePicker from '../components/ThemePicker';
import { applyTheme, isThemeId, DEFAULT_THEME, type ThemeId } from '../theme';
import { getProfile, saveProfile, getSettings, saveSettings } from '../db';
import { movementFor } from '../data/movements';
import {
  isNative, requestNotificationPermission, hasNotificationPermission,
  scheduleWindowReminders, cancelWindowReminders,
} from '../engine/notifications';
import { installPlatform } from '../engine/install';
import { generateDayPlan } from '../engine/planGenerator';
import { localDate, dayIndexFor, daysBetweenDates } from '../engine/dates';
import { shouldRebaseline } from '../engine/coach';
import { cloudConfigured } from '../cloud/config';
import { useCloudSync } from '../hooks/useCloudSync';
import type { Profile, AppSettings, CounterVariant } from '../types';

type NotifState = 'granted' | 'denied' | 'unsupported';

// Friends and Squad used to head this list; both have shipped.
const UPCOMING_FEATURES = [
  { icon: Sparkles, title: 'Motivational nudges', subtitle: 'Playful, max two a day' },
  { icon: Camera, title: 'Camera auto-count', subtitle: 'Pose detection counts reps for you' },
  { icon: Watch, title: 'Watch app', subtitle: 'Log sets from your wrist' },
  { icon: Trophy, title: 'Squad goals', subtitle: 'A shared weekly target with friends' },
] as const;

const COUNTER_OPTIONS: { key: CounterVariant; label: string }[] = [
  { key: 'cadenceRing', label: 'Ring' },
  { key: 'bigNumeral', label: 'Big number' },
  { key: 'ladderLane', label: 'Ladder' },
];

/** Section label above a group of rows. */
function SectionLabel({ children }: { children: string }) {
  return <h2 className="text-[11px] font-normal tracking-[0.1em] text-neutral-500 px-0.5">{children}</h2>;
}

const CHEVRON = <span aria-hidden className="text-[13px] text-neutral-600">›</span>;

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

  const initial = (profile.name.trim()[0] || '·').toUpperCase();
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

  const updateSetting = async (patch: Partial<AppSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    await saveSettings(next);
  };

  const theme: ThemeId = isThemeId(settings.theme) ? settings.theme : DEFAULT_THEME;

  const chooseTheme = (id: ThemeId) => {
    // On screen first, saved second: the swatch should answer the tap in the
    // same frame, not after an IndexedDB write.
    applyTheme(id);
    void updateSetting({ theme: id });
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
              <span className={`text-[17px] font-medium ${profile.name.trim() ? '' : 'text-neutral-500'}`}>{profile.name.trim() || 'Add your name'}</span>
              <span className="text-[11.5px] text-neutral-500 truncate">
                {account ? (account.email ?? 'Synced') : 'This phone only'}
              </span>
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
            <span className="text-[11px] text-neutral-600">
              {account ? 'Used in greetings, and shown to friends in your squad.' : 'Stays on this phone. Used in greetings only.'}
            </span>
          </span>
        )}
      </div>

      <div className="flex flex-col gap-1.75">
        <SectionLabel>YOUR WORKOUT</SectionLabel>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst
            icon={<Dumbbell size={14} />}
            title="Moves, kit & schedule"
            subtitle={`${movementFor(profile, 'push').name} · ${movementFor(profile, 'pull').name} · ${movementFor(profile, 'squat').name}`}
            trailing={CHEVRON}
            onClick={() => navigate('/settings/workout')}
          />
          <ListRow
            icon={<Gauge size={14} />}
            title="Retest your maxes"
            subtitle={
              profile.maxesEstimated
                ? 'Estimated from your level · test for accuracy'
                : retestDue
                  ? `Due now · last tested ${lastTestedLabel}`
                  : `${profile.maxes.push} push · ${profile.maxes.pull} pull · ${profile.maxes.squat} squat`
            }
            trailing={CHEVRON}
            onClick={() => navigate('/settings/retest')}
          />
        </div>
      </div>

      <section className="flex flex-col gap-1.75">
        <SectionLabel>APPEARANCE</SectionLabel>
        <div className="rounded-[14px] bg-surface shadow-sm px-3.5 py-3.5 flex flex-col gap-4">
          <div className="flex flex-col gap-2.5">
            <span className="text-[13.5px]">Colour theme</span>
            <ThemePicker value={theme} onChange={chooseTheme} />
          </div>
          <div className="flex flex-col gap-2">
            <span className="flex flex-col gap-px">
              <span className="text-[13.5px]">Rep counter</span>
              <span className="text-[11px] text-neutral-600">What fills the screen during a set</span>
            </span>
            <ModeChip
              options={COUNTER_OPTIONS}
              value={settings.counterVariant}
              onChange={(counterVariant) => void updateSetting({ counterVariant })}
            />
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-1.75">
        <SectionLabel>COUNTER</SectionLabel>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          <ListRow
            isFirst icon={<Mic size={14} />} title="Voice count" subtitle="Says every rep out loud"
            trailing={<Toggle size="dense" label="Voice count" on={settings.voice} onToggle={() => updateSetting({ voice: !settings.voice })} />}
          />
          <ListRow
            icon={<Timer size={14} />} title="Metronome ticks" subtitle="Down / up cue tones"
            trailing={<Toggle size="dense" label="Metronome ticks" on={settings.ticks} onToggle={() => updateSetting({ ticks: !settings.ticks })} />}
          />
          <ListRow
            icon={<Vibrate size={14} />} title="Haptics" subtitle="A pulse per rep"
            trailing={<Toggle size="dense" label="Haptics" on={settings.haptics} onToggle={() => updateSetting({ haptics: !settings.haptics })} />}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.75">
        <SectionLabel>REMINDERS</SectionLabel>
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
                label="Window reminders"
                on={settings.reminders && notifPermission === 'granted'}
                onToggle={toggleReminders}
              />
            }
          />
        </div>
      </div>

      <section className="flex flex-col gap-1.75">
        <SectionLabel>ACCOUNT & ABOUT</SectionLabel>
        <div className="rounded-[14px] bg-surface shadow-sm overflow-hidden">
          {cloudConfigured && (
            <ListRow isFirst icon={<Cloud size={14} />} title="Account & sync" subtitle={account ? 'Backing up as you go' : 'Back up and restore on a new device'} trailing={CHEVRON} onClick={() => navigate('/settings/sync')} />
          )}
          <ListRow isFirst={!cloudConfigured} icon={<Lock size={14} />} title="Data & privacy" subtitle={cloudConfigured ? 'What\u2019s stored, and where' : 'On-device only, nothing shared'} trailing={CHEVRON} onClick={() => navigate('/settings/privacy')} />
          <ListRow icon={<Info size={14} />} title="About Rungs" subtitle={`Version ${__APP_VERSION__}`} />
        </div>
      </section>

      <div className="flex-none rounded-[14px] bg-surface shadow-sm overflow-hidden">
        <button
          onClick={() => setUpcomingOpen((v) => !v)}
          aria-expanded={upcomingOpen}
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

      <div className="text-[11.5px] leading-[1.5] text-neutral-600 text-center pt-1">
        Rungs is free forever. No ads, no paywall,<br />no locked exercises.
      </div>
    </div>
  );
}
