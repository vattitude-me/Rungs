import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mic, Timer, Vibrate, Bell, Lock, Info, ChevronDown,
  UserPlus, Users, Sparkles, Cloud, Camera, Watch, Trophy,
} from 'lucide-react';
import Button from '../components/Button';
import Toggle from '../components/Toggle';
import ListRow from '../components/ListRow';
import { getProfile, saveProfile, getSettings, saveSettings } from '../db';
import {
  isNative, requestNotificationPermission, hasNotificationPermission,
  scheduleWindowReminders, cancelWindowReminders,
} from '../engine/notifications';
import { generateDayPlan } from '../engine/planGenerator';
import { localDate, dayIndexFor } from '../engine/dates';
import type { Profile, AppSettings } from '../types';

type NotifState = 'granted' | 'denied' | 'unsupported';

const UPCOMING_FEATURES = [
  { icon: Cloud, title: 'Accounts & sync', subtitle: 'Sign in, merge history across devices' },
  { icon: UserPlus, title: 'Friends', subtitle: 'Add friends, see their streaks' },
  { icon: Users, title: 'Squad', subtitle: 'Group feed, leaderboards' },
  { icon: Sparkles, title: 'Motivational nudges', subtitle: 'Playful, max two a day' },
  { icon: Camera, title: 'Camera auto-count', subtitle: 'Pose detection counts reps for you' },
  { icon: Watch, title: 'Watch app', subtitle: 'Log sets from your wrist' },
  { icon: Trophy, title: 'Challenges', subtitle: 'Timed group challenges' },
] as const;

export default function Settings() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [upcomingOpen, setUpcomingOpen] = useState(false);
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

  if (!profile || !settings) return null;

  const initial = (profile.name.trim()[0] || 'A').toUpperCase();

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
                    : '5 minutes before each window, while the app is open'
            }
            trailing={
              <Toggle
                size="dense"
                on={settings.reminders && notifPermission === 'granted'}
                onToggle={toggleReminders}
              />
            }
          />
          <ListRow icon={<Lock size={14} />} title="Data & privacy" subtitle="On-device only, nothing shared" trailing={<span className="text-[13px] text-neutral-600">›</span>} onClick={() => navigate('/settings/privacy')} />
          <ListRow icon={<Info size={14} />} title="About Rungs" subtitle={`v${__APP_VERSION__} · free forever`} trailing={<span className="text-[13px] text-neutral-600">›</span>} />
        </div>
      </div>

      <div className="text-[11.5px] leading-[1.5] text-neutral-600 text-center pt-1">
        Rungs is free forever. No ads, no paywall,<br />no locked exercises.
      </div>
    </div>
  );
}
