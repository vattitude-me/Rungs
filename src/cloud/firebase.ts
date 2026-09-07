import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { firebaseConfig, cloudConfigured } from './config';

let app: FirebaseApp | undefined;
let authInstance: Auth | undefined;
let dbInstance: Firestore | undefined;

/** Initialised on first use rather than at import, so an app built without
 * cloud config never constructs a Firebase client at all. */
function ensureApp(): FirebaseApp {
  if (!cloudConfigured) throw new Error('Firebase is not configured for this build.');
  app ??= initializeApp(firebaseConfig);
  return app;
}

export function cloudAuth(): Auth {
  authInstance ??= getAuth(ensureApp());
  return authInstance;
}

export function cloudDb(): Firestore {
  dbInstance ??= getFirestore(ensureApp());
  return dbInstance;
}
