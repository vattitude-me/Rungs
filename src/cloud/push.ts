import { Capacitor } from '@capacitor/core';
import { doc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { getMessaging, getToken, isSupported, type Messaging } from 'firebase/messaging';
import { cloudDb } from './firebase';
import { vapidKey } from './config';
import { deviceId, deviceLabel } from './device';

/** Where a browser's push token lives. Tokens are per-browser-install, so
 * they're keyed by the same device id the backup uses - one row per device,
 * replaced rather than accumulated when a token is refreshed. */
function tokenRef(uid: string) {
  return doc(cloudDb(), 'users', uid, 'pushTokens', deviceId());
}

let messagingInstance: Messaging | undefined;

/** Whether this browser can receive web push at all.
 *
 * The native app uses local notifications and never needs this - it schedules
 * against the OS directly, which works offline and without a server. Web push
 * is the fallback for browsers, where nothing can run while the tab is closed.
 *
 * On iOS this returns false until the site is installed to the Home Screen:
 * Safari only exposes the Push API to standalone web apps, so asking for
 * permission in a normal tab would silently never deliver anything.
 */
export async function pushSupported(): Promise<boolean> {
  if (Capacitor.isNativePlatform()) return false;
  if (!vapidKey) return false;
  if (typeof window === 'undefined') return false;
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return false;
  if (!('PushManager' in window)) return false;
  return isSupported().catch(() => false);
}

/** True on an iOS browser that supports push only once installed to the Home
 * Screen, and hasn't been. The UI uses this to explain the extra step rather
 * than offering a toggle that can't work. */
export function needsHomeScreenInstall(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) ||
    // iPadOS 13+ reports itself as a Mac; touch points give it away.
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (!isIOS) return false;
  const standalone = window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as { standalone?: boolean }).standalone === true;
  return !standalone;
}

function messaging(): Messaging {
  messagingInstance ??= getMessaging();
  return messagingInstance;
}

/** Registers this browser for push and records the token against the account,
 * so the reminder worker knows where to send. Returns false when permission
 * was refused or the browser can't do push. */
export async function registerPush(uid: string): Promise<boolean> {
  if (!(await pushSupported())) return false;

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  // vite-plugin-pwa registers its own service worker; reuse it rather than
  // registering a second one, which browsers scope-conflict on.
  const registration = await navigator.serviceWorker.ready;
  const token = await getToken(messaging(), {
    vapidKey,
    serviceWorkerRegistration: registration,
  });
  if (!token) return false;

  await setDoc(tokenRef(uid), {
    token,
    label: deviceLabel(),
    updatedAt: serverTimestamp(),
  });
  return true;
}

/** Forgets this browser's token, so the worker stops sending to it. Called
 * when the user turns reminders off or disconnects the device. */
export async function unregisterPush(uid: string): Promise<void> {
  await deleteDoc(tokenRef(uid)).catch(() => {
    // Already gone, or offline. The worker prunes tokens the push service
    // reports as stale anyway, so this is best-effort.
  });
}
