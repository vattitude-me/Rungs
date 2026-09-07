import {
  GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  signInWithCredential, signOut as fbSignOut, onAuthStateChanged, deleteUser,
  reauthenticateWithPopup, reauthenticateWithCredential, type User,
} from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
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

/** Builds the Firebase web-SDK credential from a native Google Sign-In
 * result, so a native sign-in ends up in the same `Auth` instance (and is
 * visible to the same `onAuthStateChanged`) as a web one. */
function credentialFromNativeResult(idToken: string | undefined, accessToken: string | undefined) {
  if (!idToken) {
    throw new Error('Google sign-in did not return an ID token.');
  }
  return GoogleAuthProvider.credential(idToken, accessToken);
}

/** The native Google Sign-In dialog rejects with whatever message the
 * Android Credential Manager / Play Services happened to throw - useful for
 * debugging, not for a user to act on. `GetCredentialException` in
 * particular carries no stable error code (only `FirebaseAuthException` does,
 * per the plugin's own `createErrorCode`), so a network failure below the
 * picker - confirmed against a real device log: Play Services' own OAuth
 * token request failing with a Cronet network error right after the account
 * is chosen - only shows up as free text like "Network error.". Matching on
 * that text is the only signal available; anything unrecognised is left as
 * the plugin gave it rather than guessed at. */
function describeNativeSignInError(message: string): string {
  if (/network/i.test(message)) {
    return "Couldn't reach Google - check your connection and try again.";
  }
  if (/cancel/i.test(message)) {
    return 'Sign-in was cancelled.';
  }
  return message;
}

export async function signIn(): Promise<CloudAccount | null> {
  const auth = cloudAuth();

  // A browser popup or redirect can't be used inside a Capacitor WebView -
  // there's no browser chrome to host a popup, and a redirect has nowhere to
  // navigate back to (the app isn't served from a reachable origin). Native
  // builds use the OS's own Google Sign-In dialog instead, then hand the
  // resulting token to the web SDK so the rest of the app - Firestore rules,
  // onAuthStateChanged - sees one consistent signed-in user either way.
  if (Capacitor.isNativePlatform()) {
    let result;
    try {
      result = await FirebaseAuthentication.signInWithGoogle();
    } catch (err) {
      const message = (err as { message?: string }).message ?? 'Sign-in failed.';
      throw new Error(describeNativeSignInError(message));
    }
    const credential = credentialFromNativeResult(
      result.credential?.idToken,
      result.credential?.accessToken
    );
    const signedIn = await signInWithCredential(auth, credential);
    return toAccount(signedIn.user);
  }

  const provider = new GoogleAuthProvider();
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
  // The native plugin keeps its own Google session apart from Firebase's -
  // signing out of Firebase alone would leave native sign-in silently
  // re-using the old Google account next time instead of prompting again.
  if (Capacitor.isNativePlatform()) {
    await FirebaseAuthentication.signOut();
  }
  await fbSignOut(cloudAuth());
}

/** Permanently removes the Google account's link to Rungs, so no trace of the
 * user remains in Firebase Auth.
 *
 * Firebase refuses to delete an account whose sign-in is more than a few
 * minutes old, so a stale session is re-authenticated first rather than
 * failing in the user's face mid-deletion. Native builds can't show a popup,
 * so there the caller is told to sign in again instead.
 */
export async function deleteAccount(): Promise<void> {
  const auth = cloudAuth();
  const user = auth.currentUser;
  if (!user) return;

  try {
    await deleteUser(user);
  } catch (err) {
    const code = (err as { code?: string }).code ?? '';
    if (code !== 'auth/requires-recent-login') throw err;

    if (Capacitor.isNativePlatform()) {
      // Same native-dialog path as signing in, then reauthenticate the
      // existing web-SDK user with the fresh credential rather than signing
      // in as a new one.
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = credentialFromNativeResult(
        result.credential?.idToken,
        result.credential?.accessToken
      );
      await reauthenticateWithCredential(user, credential);
      await deleteUser(user);
      return;
    }
    await reauthenticateWithPopup(user, new GoogleAuthProvider());
    await deleteUser(user);
  }
}
