# Rungs reminder worker

Sends window reminders to the **installed web app**. The Android build doesn't
need this — it hands its notifications to the OS, which fires them with no
network and no server. A browser can't do that: once the tab is closed, none
of the app is running, so the nudge has to come from outside.

Runs as a small container. It makes only outbound calls, publishes no ports,
and holds no state of its own.

## What it does

Every 5 minutes it asks one question per signed-in account: *is a rep window
starting in the next few minutes, in that user's own timezone?* If so, it
pushes a notification naming the reps due.

The schedule comes from the user's existing cloud backup — the app already
syncs the profile, so nothing extra had to be stored to make this work. The
one field added for it is `timeZone`, captured automatically on app open,
because window times are local wall-clock strings and "09:00" is meaningless
to a server without it.

## Setup

**1. Get a service account key**

Firebase Console → gear icon → *Project settings* → *Service accounts* →
**Generate new private key**. Save it in this folder as `service-account.json`.

> This key has full admin access to Firestore and can send push as your app.
> It's gitignored (under any filename), and must never be committed or shared.

**2. Enable web push**

Firebase Console → *Project settings* → *Cloud Messaging* → *Web Push
certificates* → **Generate key pair**. Copy the key pair value and set it as
`VITE_FIREBASE_VAPID_KEY` in the web app's environment (Vercel → Settings →
Environment Variables), then redeploy — Vite inlines it at build time, so a
build made before the variable existed won't have it.

**3. Start it**

```sh
docker compose up -d
```

## Checking it

```sh
docker compose logs -f                          # live output
docker compose run --rm worker node index.js --once   # one tick, then exit
```

A quiet log is normal — it only prints when it actually sends something. To
confirm it's working end to end, set a window a few minutes ahead in the app,
then watch for the line.

## Notes

- `TICK_MINUTES` must match how often the worker actually runs. It treats a
  window as due when the nudge moment falls inside the next tick, so a
  mismatch means reminders are missed or sent late.
- Sends are recorded per device, so a restart or a missed tick can't produce a
  duplicate notification.
- Tokens the push service reports as dead (browser uninstalled, permission
  revoked) are deleted automatically rather than retried forever.
- Accounts with no timezone recorded are skipped rather than guessed at —
  better no reminder than one at 3am.
