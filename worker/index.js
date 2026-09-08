/**
 * Rungs reminder worker.
 *
 * The native app schedules its own notifications with the OS, which keeps
 * working with no network and no server. Browsers can't do that - nothing of
 * the app runs while the tab is closed - so installed web apps get their
 * reminders pushed from here instead.
 *
 * Runs on a timer, and on each tick asks a single question: for every account
 * with a registered browser, is a rep window starting within the next tick's
 * worth of time, in that user's own timezone? If so, push a nudge.
 *
 * Deliberately stateless apart from one field per device recording the last
 * window it was told about, so a restart, a missed tick, or two workers
 * running at once can't produce a double notification.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { readFileSync, existsSync, statSync } from 'node:fs';

/** How long before a window to nudge. Matches LEAD_MINUTES in the app, so web
 * and native reminders arrive at the same moment. */
const LEAD_MINUTES = 5;

/** How often the timer fires. A window is "due" when its lead time falls in
 * the next tick, so this must match the interval the worker actually runs on
 * or reminders will be missed (set too short) or sent late (set too long).
 *
 * At 5 minutes a nudge lands within five minutes of its intended moment,
 * which given LEAD_MINUTES means it arrives somewhere between five minutes
 * before the window and right on it - close enough to be useful, and cheap:
 * a tick is one small Firestore read per account. */
const TICK_MINUTES = Number(process.env.TICK_MINUTES ?? 5);

/** Tiers are total daily reps; the app blends toward an even split as the
 * tier climbs. Mirrored from src/engine/coach.ts - the worker has to predict
 * the same windows the app will show, so this stays in step with it. */
const EXERCISES = ['push', 'pull', 'squat'];
const EXERCISE_LABELS = { push: 'push-ups', pull: 'pull-ups', squat: 'squats' };

function computeTierTargets(maxes, tier) {
  const total = Object.values(maxes).reduce((a, b) => a + b, 0);
  // With no baseline at all, split evenly rather than dividing by zero.
  if (total <= 0) {
    const each = Math.round(tier / 3);
    return { push: each, pull: each, squat: each };
  }
  // Blend from strength-weighted at tier 100 to even at tier 300.
  const evenness = (tier - 100) / 200;
  const targets = {};
  let assigned = 0;
  EXERCISES.forEach((ex, i) => {
    const weighted = maxes[ex] / total;
    const share = weighted + (1 / 3 - weighted) * evenness;
    const value = i === EXERCISES.length - 1 ? tier - assigned : Math.round(tier * share);
    targets[ex] = Math.max(0, value);
    assigned += targets[ex];
  });
  return targets;
}

/** Evenly spaced times across the waking span, used when a profile has no
 * explicit windowTimes. Mirrors the app's fallback. */
function evenTimes(count, wake, sleep) {
  const [wh, wm] = wake.split(':').map(Number);
  const [sh, sm] = sleep.split(':').map(Number);
  const start = wh * 60 + wm;
  const end = sh * 60 + sm;
  const span = Math.max(0, end - start);
  const times = [];
  for (let i = 0; i < count; i++) {
    const at = start + Math.round((span * (i + 1)) / (count + 1));
    times.push(`${String(Math.floor(at / 60)).padStart(2, '0')}:${String(at % 60).padStart(2, '0')}`);
  }
  return times;
}

/** The reps a window carries, so the notification can say what's due rather
 * than a generic nudge. Splits each exercise evenly across the day's windows,
 * matching splitIntoWindows. */
function windowItems(targets, windowCount, index) {
  const items = [];
  for (const ex of EXERCISES) {
    const remaining = targets[ex];
    if (remaining <= 0) continue;
    const perWindow = Math.ceil(remaining / windowCount);
    // The last window takes the remainder so rounding never strands reps.
    const reps = index === windowCount - 1
      ? Math.max(0, remaining - perWindow * (windowCount - 1))
      : perWindow;
    if (reps > 0) items.push(`${reps} ${EXERCISE_LABELS[ex]}`);
  }
  return items;
}

/** Minutes since midnight, in the given IANA timezone. */
function localMinutes(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour').value);
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
}

/** YYYY-MM-DD in the given timezone, used to key "which window was last sent"
 * so the marker resets naturally at the user's own midnight. */
function localDate(now, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** The window due within this tick, or null. Returns the window's index and
 * the local date so the caller can record what it sent. */
function dueWindow(profile, now) {
  const timeZone = profile.timeZone;
  if (!timeZone) return null;

  let times = Array.isArray(profile.windowTimes) ? [...profile.windowTimes] : null;
  if (!times || times.length === 0) {
    const count = profile.windowCount || 4;
    times = evenTimes(count, profile.wake || '06:30', profile.sleep || '23:00');
  }
  times.sort((a, b) => a.localeCompare(b));

  let nowMinutes;
  try {
    nowMinutes = localMinutes(now, timeZone);
  } catch {
    // An unrecognised timezone would otherwise throw on every tick forever.
    return null;
  }

  for (let i = 0; i < times.length; i++) {
    const [h, m] = times[i].split(':').map(Number);
    if (Number.isNaN(h) || Number.isNaN(m)) continue;
    const fireAt = h * 60 + m - LEAD_MINUTES;
    // Due if the nudge moment falls inside this tick's window.
    if (nowMinutes >= fireAt && nowMinutes < fireAt + TICK_MINUTES) {
      return { index: i, at: times[i], count: times.length, date: localDate(now, timeZone) };
    }
  }
  return null;
}

/** The window a manual trigger should pretend is due: the next one still
 * ahead today, or the first of tomorrow if the day is done. Picking a real
 * window rather than inventing one keeps the notification text honest - it
 * names reps the user is actually going to be asked for. */
function forcedWindow(profile, now) {
  const timeZone = profile.timeZone || 'UTC';
  let times = Array.isArray(profile.windowTimes) ? [...profile.windowTimes] : null;
  if (!times || times.length === 0) {
    const count = profile.windowCount || 4;
    times = evenTimes(count, profile.wake || '06:30', profile.sleep || '23:00');
  }
  times.sort((a, b) => a.localeCompare(b));
  if (times.length === 0) return null;

  let nowMinutes;
  try {
    nowMinutes = localMinutes(now, timeZone);
  } catch {
    nowMinutes = 0;
  }

  const index = times.findIndex((t) => {
    const [h, m] = t.split(':').map(Number);
    return !Number.isNaN(h) && h * 60 + m >= nowMinutes;
  });
  const pick = index === -1 ? 0 : index;
  return { index: pick, at: times[pick], count: times.length, date: localDate(now, timeZone) };
}

/** Explains, per account, whether a reminder could be sent right now and what
 * is missing if not.
 *
 * A worker that only prints when it sends is quiet for two very different
 * reasons - nothing was due, or nothing *can ever* be due - and from the
 * outside those look identical. This tells them apart. */
async function diagnose(db, now) {
  const users = await db.collection('users').get();
  console.log(`[rungs] diagnose at ${now.toISOString()} - ${users.size} account(s)`);

  for (const userDoc of users.docs) {
    const uid = userDoc.id;
    const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();

    const profileSnap = await db
      .collection('users').doc(uid)
      .collection('backup').doc('profile')
      .collection('chunks').get();
    const profile = profileSnap.docs
      .flatMap((d) => d.data().rows ?? [])
      .find((row) => row && row.onboardingComplete);

    console.log(`\n  account ${uid}`);
    console.log(`    devices registered for push : ${tokensSnap.size}`);
    for (const t of tokensSnap.docs) {
      const d = t.data();
      console.log(`      - ${d.label ?? t.id} (last window sent: ${d.lastWindow ?? 'none'})`);
    }

    if (!profile) {
      console.log('    profile                     : MISSING from the backup');
      console.log('    -> the app has not synced a completed profile for this account.');
      continue;
    }

    console.log(`    name                        : ${profile.name ?? '(unset)'}`);
    console.log(`    timeZone                    : ${profile.timeZone ?? 'MISSING'}`);
    const times = Array.isArray(profile.windowTimes) && profile.windowTimes.length
      ? [...profile.windowTimes].sort((a, b) => a.localeCompare(b))
      : evenTimes(profile.windowCount || 4, profile.wake || '06:30', profile.sleep || '23:00');
    console.log(`    windows                     : ${times.join(', ')}`);

    if (profile.timeZone) {
      try {
        const mins = localMinutes(now, profile.timeZone);
        const hh = String(Math.floor(mins / 60)).padStart(2, '0');
        const mm = String(mins % 60).padStart(2, '0');
        console.log(`    local time there            : ${hh}:${mm}`);
      } catch {
        console.log('    local time there            : unreadable timezone');
      }
    }

    const due = dueWindow(profile, now);
    console.log(`    a window due this tick      : ${due ? `yes, ${due.at}` : 'no'}`);

    // The blockers, in the order they stop a send.
    if (tokensSnap.empty) {
      console.log('    -> BLOCKED: no device is registered for push.');
      console.log('       In the installed app: Settings > Window reminders (toggle on).');
      console.log('       It must be the installed app, and signed in to this account.');
    } else if (!profile.timeZone) {
      console.log('    -> BLOCKED: no timeZone recorded; open the app once to set it.');
    } else if (!due) {
      console.log(`       (nothing wrong - reminders fire ${LEAD_MINUTES}m before a window,`);
      console.log(`        within a ${TICK_MINUTES}m tick. Use --send-now to test immediately.)`);
    } else {
      console.log('    -> would send now.');
    }
  }
}

async function sendToUser(db, messaging, userDoc, now, opts = {}) {
  const uid = userDoc.id;

  const tokensSnap = await db.collection('users').doc(uid).collection('pushTokens').get();
  if (tokensSnap.empty) return { sent: 0, pruned: 0 };

  // The profile lives in the backup, written by the app itself - the worker
  // never has to be told a schedule separately.
  const profileSnap = await db
    .collection('users').doc(uid)
    .collection('backup').doc('profile')
    .collection('chunks').get();
  const profile = profileSnap.docs
    .flatMap((d) => d.data().rows ?? [])
    .find((row) => row && row.onboardingComplete);
  if (!profile) return { sent: 0, pruned: 0 };

  // `force` is the manual trigger: it pretends the next window is due right
  // now so a real notification goes down the real path. Everything after this
  // line is identical to a scheduled send - that's the point, a test that
  // skipped the send path would only prove the test works.
  const due = opts.force ? forcedWindow(profile, now) : dueWindow(profile, now);
  if (!due) return { sent: 0, pruned: 0 };

  const targets = computeTierTargets(
    profile.maxes ?? { push: 0, pull: 0, squat: 0 },
    profile.tier ?? 100
  );
  const items = windowItems(targets, due.count, due.index);
  const body = items.join(' + ') || 'Time for a set';
  const marker = `${due.date}#${due.index}`;

  let sent = 0;
  let pruned = 0;

  for (const tokenDoc of tokensSnap.docs) {
    const data = tokenDoc.data();
    if (!data.token) continue;
    // Already nudged for this window on this device - a retried tick or a
    // second worker must not send it twice.
    if (!opts.force && data.lastWindow === marker) continue;

    try {
      await messaging.send({
        token: data.token,
        // Data-only: the service worker decides how to display it, which a
        // `notification` payload would bypass along with its click handling.
        data: {
          title: `Window at ${due.at}`,
          body,
          tag: `rungs-${marker}`,
          url: '/today',
        },
        webpush: {
          headers: { Urgency: 'high', TTL: String(TICK_MINUTES * 60) },
        },
      });
      await tokenDoc.ref.update({ lastWindow: marker, lastSentAt: FieldValue.serverTimestamp() });
      sent++;
    } catch (err) {
      const code = err?.errorInfo?.code ?? err?.code ?? '';
      // The push service says this browser is gone - uninstalled, cleared, or
      // permission revoked. Keeping it would mean failing forever.
      if (
        code.includes('registration-token-not-registered') ||
        code.includes('invalid-argument') ||
        code.includes('invalid-registration-token')
      ) {
        await tokenDoc.ref.delete().catch(() => {});
        pruned++;
      } else {
        console.error(`[rungs] send failed for ${uid}/${tokenDoc.id}:`, code || err);
      }
    }
  }

  return { sent, pruned };
}

async function tick(db, messaging, opts = {}) {
  const now = new Date();
  const users = await db.collection('users').get();

  let sent = 0;
  let pruned = 0;
  for (const userDoc of users.docs) {
    try {
      const result = await sendToUser(db, messaging, userDoc, now, opts);
      sent += result.sent;
      pruned += result.pruned;
    } catch (err) {
      // One bad account must not stop everyone else's reminders.
      console.error(`[rungs] user ${userDoc.id} failed:`, err?.message ?? err);
    }
  }

  // A forced run always reports, including zero: the person who typed
  // --send-now is owed an answer either way, where a scheduled tick finding
  // nothing is just a quiet night.
  if (sent || pruned || opts.force) {
    console.log(`[rungs] ${now.toISOString()} sent=${sent} pruned=${pruned} users=${users.size}`);
    if (opts.force && !sent) {
      console.log('[rungs] nothing was sent - run --diagnose to see what is missing.');
    }
  }
}

function credential() {
  const inline = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inline) return cert(JSON.parse(inline));

  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (path) {
    // A bind mount whose source file doesn't exist yet makes Docker create a
    // *directory* at that path, so the readable error here is "EISDIR" from
    // deep inside fs. Say what actually needs doing instead.
    if (!existsSync(path) || statSync(path).isDirectory()) {
      throw new Error(
        `No service account key at ${path}.\n` +
        '  Firebase Console > Project settings > Service accounts >\n' +
        '  "Generate new private key", save it as service-account.json\n' +
        '  next to compose.yaml, then: docker compose up -d\n' +
        '  (If a directory was created there by an earlier run, remove it first.)'
      );
    }
    return cert(JSON.parse(readFileSync(path, 'utf8')));
  }

  return applicationDefault();
}

async function main() {
  initializeApp({ credential: credential() });
  const db = getFirestore();
  const messaging = getMessaging();

  // Manual controls, for confirming the pipeline end to end without waiting
  // for a real window to come round.
  if (process.argv.includes('--diagnose')) {
    await diagnose(db, new Date());
    return;
  }
  if (process.argv.includes('--send-now')) {
    console.log('[rungs] forcing a send, ignoring the schedule');
    await tick(db, messaging, { force: true });
    return;
  }
  if (process.argv.includes('--once')) {
    await tick(db, messaging);
    return;
  }

  console.log(`[rungs] reminder worker started, tick every ${TICK_MINUTES}m`);
  await tick(db, messaging);
  setInterval(() => {
    tick(db, messaging).catch((err) => console.error('[rungs] tick failed:', err));
  }, TICK_MINUTES * 60 * 1000);
}

main().catch((err) => {
  console.error('[rungs] fatal:', err);
  process.exit(1);
});
