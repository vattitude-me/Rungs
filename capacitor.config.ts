import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.vatsakrish.rungs',
  appName: 'Rungs',
  webDir: 'dist',
  backgroundColor: '#161826',
  android: {
    backgroundColor: '#161826',
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      backgroundColor: '#161826',
      androidSplashResourceName: 'splash',
    },
    FirebaseAuthentication: {
      providers: ['google.com'],
      // The rest of the app runs on the Firebase web SDK's own Auth instance
      // (onAuthStateChanged, Firestore's request.auth) - without this flag the
      // native plugin signs into a *separate* native session and the web SDK
      // never finds out, so the app never notices it's signed in. With it, the
      // native Google dialog is used to get a credential, and src/cloud/auth.ts
      // takes that credential and completes sign-in on the web SDK itself.
      skipNativeAuth: true,
    },
  },
};

export default config;
