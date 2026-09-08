import { useCallback, useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { isInstalled, installPlatform, type InstallPlatform } from '../engine/install';

/** The event Chromium fires when it is willing to install the app. It isn't in
 * the DOM lib because it isn't a standard, but it is what every Chromium
 * browser ships. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// Chromium fires beforeinstallprompt once, early - often before React has
// mounted the component that wants it. Captured at module load and held here,
// so a card mounted later still has a live prompt to offer rather than
// silently falling back to "here are the manual steps" on a browser that
// could have done it in one tap.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function announce() {
  for (const fn of listeners) fn();
}

if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    announce();
  });
  window.addEventListener('appinstalled', () => {
    // The prompt is spent, and the browser will not offer it again.
    deferred = null;
    announce();
  });
}

export interface InstallState {
  /** Whether to show anything at all: false when native, or already installed. */
  needed: boolean;
  platform: InstallPlatform;
  /** True when `promptInstall` will show the browser's own install dialog. */
  canPrompt: boolean;
  /** Shows the browser install dialog. Resolves true if the user accepted. */
  promptInstall: () => Promise<boolean>;
}

export function useInstallPrompt(): InstallState {
  const native = Capacitor.isNativePlatform();
  const [installed, setInstalled] = useState(() => native || isInstalled());
  const [canPrompt, setCanPrompt] = useState(() => deferred !== null);

  useEffect(() => {
    if (native) return;
    const update = () => {
      setCanPrompt(deferred !== null);
      setInstalled(isInstalled());
    };
    listeners.add(update);

    // Installing from the browser's own menu doesn't reload the page, and on
    // desktop the tab stays open beside the new window. Watching display-mode
    // is what lets the card disappear on its own rather than waiting for a
    // reload the user has no reason to perform.
    const mq = window.matchMedia('(display-mode: standalone)');
    mq.addEventListener('change', update);
    update();

    return () => {
      listeners.delete(update);
      mq.removeEventListener('change', update);
    };
  }, [native]);

  const promptInstall = useCallback(async () => {
    const event = deferred;
    if (!event) return false;
    // Chromium allows a deferred prompt to be shown once. Clear it up front so
    // a double tap can't call prompt() twice on a spent event, which throws.
    deferred = null;
    announce();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === 'accepted';
  }, []);

  return {
    needed: !native && !installed,
    platform: installPlatform(canPrompt),
    canPrompt,
    promptInstall,
  };
}
