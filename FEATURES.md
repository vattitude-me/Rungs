# Feature roadmap

Working list of what Rungs doesn't do yet. Cross off or update as things
ship; this is a reference for prioritizing work, not a spec.

## Accounts & sync

- Sign-in and cross-device sync. All data is on-device only right now
  (see [src/db/index.ts](src/db/index.ts)); uninstalling or clearing
  site data loses everything permanently.
- Merge flow for local history into an account once sync lands (the
  Settings "Accounts & sync: coming soon" banner already promises this).
- Backup/restore, or at minimum a manual export (JSON download) so
  people aren't fully dependent on sync shipping before they can trust
  the app with real data.

## Social (Squad)

- Friends: add/find friends, see their streaks and PRs.
- Activity feed: the [Squad](src/pages/Squad.tsx) page currently shows
  static fake rows as a preview only; there's no real feed, no friend
  list, no backend.
- Nudges: a friend pokes you if you're behind (capped at 2/day per the
  preview copy) - not implemented.
- Leaderboards, group challenges. Next up: squad goals (a shared weekly
  target) and shared windows ("12:30 squad set").
- Depends on accounts/sync shipping first.

## Notifications & engagement

- Motivational nudges: playful local notifications, max two a day.
  Was a dead Settings row (`nudges` stub field already exists in
  [types/index.ts](src/types/index.ts)); moved to the Upcoming
  Features list rather than left as a non-functional toggle.
- Streak-at-risk reminders (e.g. "you'll lose your streak in 2 hours").
- Smarter reminder copy that reacts to how far behind the day's goal is.

## Counter & workout

- Camera auto-count: pose detection counts reps hands-free. Documented
  as a v-later flag (`counter.camera`) in the design handoff notes but
  no implementation exists.
- Shipped in 2.0: movement choice per slot (src/data/movements.ts), day
  styles (spread / single / surprise, src/engine/schedule.ts), focus,
  calorie and weight-lifted estimates (src/engine/energy.ts). Still to do:
  a fourth "core" slot (needs `Exercise` widened, which touches sync,
  DayRecord and the squad), and demo footage for the non-classic moves.
- Rest-timer customization beyond the fixed 45s between sets.
- Editing/deleting a logged set after the fact (append-only ledger by
  design, but there's no UI to correct a fat-fingered rep count).

## Growth

- Share-your-day card as an image rather than text.
- Invite link on the session done screen that deep-links into Squad.
- Health Connect / Apple Health export of calories.

## Platform

- Watch app (log sets from the wrist).
- iOS build: the app is web + Android (Capacitor) only right now;
  no Xcode project exists.
- Widget/home-screen glanceable progress (Android widget, iOS
  lock-screen widget).

## Data & account management

- Data export ("export any time" is not actually implemented - Data &
  privacy currently only offers delete-everything, not download).
- Account deletion vs. local reset distinction once accounts exist.

## Onboarding & personalization

- Re-testing baseline maxes periodically to reshape the plan (the
  original product plan called for this; today the baseline is only
  ever set once, at onboarding, or edited by re-running the flow).
- Adjustable rest-day / deload logic (currently every day carries the
  full tier target with no planned lighter days).

## Known rough edges worth fixing before new features

- No automated tests (no test runner configured in `package.json`).
- The error boundary added around the app root
  ([src/components/ErrorBoundary.tsx](src/components/ErrorBoundary.tsx))
  only offers a reload; it doesn't report anywhere, so a crash in the
  field is invisible unless the user mentions it.
