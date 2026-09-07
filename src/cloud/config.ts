/** Firebase web config, supplied at build time. These values are not secrets -
 * a web app ships them to every client by design, and Firestore security
 * rules, not config secrecy, are what actually protect the data. Sync stays
 * switched off when they're absent, so a build without them works exactly as
 * the local-only app always did.
 *
 * This lives apart from `firebase.ts` on purpose: screens that only need to
 * know *whether* cloud backup exists import `cloudConfigured` from here, and
 * pulling in the Firebase SDK just to read a boolean would put ~500 KB into
 * the main bundle for every user, configured or not. */
export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Public VAPID key for web push, from Firebase Console > Project settings >
 * Cloud Messaging > Web Push certificates. Public by design - it identifies
 * the sender to the browser's push service and carries no authority to send;
 * only the private half, which lives on the reminder worker, can do that. */
export const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY ?? '';

/** Whether this build was given Firebase credentials. Everything cloud-facing
 * checks this first so the UI can hide backup entirely rather than offering a
 * button that throws. */
export const cloudConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId
);
