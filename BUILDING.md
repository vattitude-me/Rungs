# Building Rungs

## Tech stack

React 19, TypeScript, Vite, Tailwind v4 and Dexie (IndexedDB) for a fully
offline-first PWA, wrapped for Android and iOS with Capacitor, with Firebase
handling sign-in and cross-device sync.

## Web

```bash
npm install
npm run dev            # http://localhost:5173
npm run build          # production build to dist/
npm run lint
```

## Native (Capacitor)

The `android/` and `ios/` directories are native Capacitor projects that wrap
the built web app (`dist/`) in a WebView shell: same HashRouter-based SPA, same
Dexie storage, no server required. They're checked into the repo (standard
Capacitor practice, they can carry native customizations), but build output,
local SDK paths and signing secrets are gitignored.

Capacitor copies `dist/` into the native projects rather than reading it live,
so after changing the web app or the app icons, re-sync before rebuilding:

```bash
npm run build && npx cap sync
```

### Android

#### One-time setup

Needs a JDK compatible with the Android Gradle Plugin (17–21, **not** 26) and
the Android SDK command-line tools:

```bash
brew install openjdk@21 android-commandlinetools
sdkmanager --sdk_root="$(brew --prefix)/share/android-commandlinetools" \
  "platform-tools" "platforms;android-35" "build-tools;35.0.0"
echo "sdk.dir=$(brew --prefix)/share/android-commandlinetools" > android/local.properties
```

Release builds are signed. Generate a keystore once and keep it **outside git**
and backed up somewhere durable: losing it means you can never ship an update
to the same `applicationId` again, only a new listing.

```bash
keytool -genkeypair -v -keystore android/keystore/release.keystore \
  -alias hundred -keyalg RSA -keysize 2048 -validity 10000
cp android/keystore.properties.example android/keystore.properties
# then fill in the real store/key passwords in android/keystore.properties
```

#### Building

```bash
export JAVA_HOME=$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$(brew --prefix)/share/android-commandlinetools

npm run build && npx cap sync android
cd android
./gradlew assembleDebug      # unsigned, for sideloading/testing
./gradlew assembleRelease    # signed with keystore.properties, for distribution
```

Output:

- Debug: `android/app/build/outputs/apk/debug/app-debug.apk`
- Release: `android/app/build/outputs/apk/release/app-release.apk`

### iOS

Needs Xcode:

```bash
npm run build && npx cap sync ios
npx cap open ios
```

Then build and run from Xcode as usual.
