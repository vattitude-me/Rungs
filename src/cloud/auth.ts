import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signOut as fbSignOut, onAuthStateChanged, type User,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { cloudAuth } from './firebase';

export type { User };

/** The signed-in user's display identity, or null when signed out. */
export interface CloudAccount {
  uid: string;
  email: string | null;
  displayName: string | null;
}

export function toAccount(user: User | null): CloudAccount | null {
  if (!user) return null;
  return { uid: user.uid, email: user.email, displayName: user.displayName };
}

export function watchAccount(fn: (account: CloudAccount | null) => void): () => void {
  return onAuthStateChanged(cloudAuth(), (user) => fn(toAccount(user)));
}

/** Completes a redirect-based sign-in, if this load is the return leg of one.
 * Safe to call on every startup; resolves to null on a normal load. */
export async function resumeSignIn(): Promise<CloudAccount | null> {
  const result = await getRedirectResult(cloudAuth());
  return toAccount(result?.user ?? null);
}

export async function signIn(): Promise<CloudAccount | null> {
  const provider = new GoogleAuthProvider();
  const auth = cloudAuth();

  // A popup can't be used inside a Capacitor WebView - there's no browser
  // chrome to host it, and the OAuth window has no way back to the app. Native
  // builds redirect instead and pick the result up on the next load.
  if (Capacitor.isNativePlatform()) {
    await signInWithRedirect(auth, provider);
    return null;
  }

  try {
    const result = await signInWithPopup(auth, provider);
    return toAccount(result.user);
  } catch (err) {
    // Some mobile browsers and embedded webviews block popups outright. Falling
    // back to a redirect keeps sign-in working there instead of dead-ending.
    const code = (err as { code?: string }).code ?? '';
    if (code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment') {
      await signInWithRedirect(auth, provider);
      return null;
    }
    throw err;
  }
}

export async function signOut(): Promise<void> {
  await fbSignOut(cloudAuth());
}
