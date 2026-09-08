import { Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';
import { getProfile, saveProfile } from './db';
import { useReminders } from './hooks/useReminders';
import { useAndroidBackButton } from './hooks/useAndroidBackButton';
import { useNudgeNotifications } from './hooks/useNudgeNotifications';
import type { Profile } from './types';
import PhoneFrame from './components/PhoneFrame';
import Layout from './components/Layout';
import Welcome from './pages/onboarding/Welcome';
import Name from './pages/onboarding/Name';
import Baseline from './pages/onboarding/Baseline';
import Schedule from './pages/onboarding/Schedule';
import PlanPreview from './pages/onboarding/PlanPreview';
import Session from './pages/Session';
import LogReps from './pages/LogReps';
import Today from './pages/Today';
import Progress from './pages/Progress';
import Squad from './pages/Squad';
import Settings from './pages/Settings';
import DataPrivacy from './pages/DataPrivacy';
import Retest from './pages/Retest';
import Sync from './pages/Sync';
import { CloudSyncProvider } from './hooks/useCloudSync';

/** Hooks that need the cloud context, so they sit inside the provider rather
 * than beside it. */
function CloudSideEffects() {
  useNudgeNotifications();
  return null;
}

export default function App() {
  const [profile, setProfile] = useState<Profile | null | undefined>(undefined);
  useReminders();
  useAndroidBackButton();

  useEffect(() => {
    getProfile().then(async (p) => {
      setProfile(p ?? null);
      if (!p) return;
      // Window times are local wall-clock strings, so the reminder worker
      // needs to know which local. Refreshed on every open rather than set
      // once, so it follows the user if they travel or their region changes
      // its DST rules.
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone && zone !== p.timeZone) {
        await saveProfile({ ...p, timeZone: zone });
      }
    });
  }, []);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    StatusBar.setStyle({ style: Style.Dark });
    StatusBar.setBackgroundColor({ color: '#161826' });
    // Keep the WebView below the system status bar rather than drawing under
    // it - the OS clock and battery own that strip, and overlaying would put
    // app content underneath them.
    StatusBar.setOverlaysWebView({ overlay: false });
  }, []);

  useEffect(() => {
    if (profile === undefined || !Capacitor.isNativePlatform()) return;
    SplashScreen.hide();
  }, [profile]);

  if (profile === undefined) {
    return (
      <PhoneFrame>
        <div className="flex items-center justify-center h-full bg-bg">
          <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        </div>
      </PhoneFrame>
    );
  }

  const needsOnboarding = !profile || !profile.onboardingComplete;

  return (
    <CloudSyncProvider>
      <CloudSideEffects />
      <PhoneFrame>
        <Routes>
          <Route path="/onboarding/welcome" element={<Welcome />} />
          <Route path="/onboarding/name" element={<Name />} />
          <Route path="/onboarding/baseline" element={<Baseline />} />
          <Route path="/onboarding/schedule" element={<Schedule />} />
          <Route path="/onboarding/plan" element={<PlanPreview />} />
          <Route path="/session" element={<Session />} />
          <Route path="/session/log" element={<LogReps />} />
          <Route path="/settings/privacy" element={<DataPrivacy />} />
          <Route path="/settings/retest" element={<Retest />} />
          <Route path="/settings/sync" element={<Sync />} />
          <Route element={<Layout />}>
            <Route path="/today" element={<Today />} />
            <Route path="/progress" element={<Progress />} />
            <Route path="/squad" element={<Squad />} />
            <Route path="/settings" element={<Settings />} />
          </Route>
          <Route
            path="*"
            element={needsOnboarding ? <Navigate to="/onboarding/welcome" replace /> : <Navigate to="/today" replace />}
          />
        </Routes>
      </PhoneFrame>
    </CloudSyncProvider>
  );
}
