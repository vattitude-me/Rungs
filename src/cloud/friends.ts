import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, query,
  orderBy, limit as fsLimit, serverTimestamp, onSnapshot, runTransaction,
  type Unsubscribe,
} from 'firebase/firestore';
import { cloudDb } from './firebase';

/** Friends, and why none of this goes through the sync engine.
 *
 * Everything in `sync.ts` is one user's own data: a single writer, merged by
 * last-write-wins, and safe to hold entirely on the device. Friends are the
 * opposite on all three counts - two accounts write to one relationship, the
 * server is the only place that can arbitrate, and a device must not be able
 * to invent a friendship by editing its local database and pushing.
 *
 * So this is read and written directly against Firestore, live, and none of it
 * is mirrored into Dexie. The cost is that Squad needs a connection; that is
 * the honest trade, because a cached friend list is a list of claims this
 * device made about other people.
 *
 * The data is split across three places, each with different visibility:
 *
 *   profiles/{uid}              - the sharing surface. Name, today's percent,
 *                                 streak. World-readable to signed-in users,
 *                                 writable only by its owner. Deliberately
 *                                 thin: this is the only thing that leaves the
 *                                 private subtree, so it holds nothing that
 *                                 isn't already meant to be seen.
 *   users/{uid}/friends/{fid}   - one edge per side, private to its owner.
 *                                 Stored twice rather than as a shared
 *                                 document so that reading your friend list
 *                                 never means reading someone else's data.
 *   users/{uid}/inbox/{id}      - incoming requests and nudges. Written by the
 *                                 sender, read and deleted by the recipient.
 *                                 The one place another user may write, which
 *                                 is why the rules constrain its shape so
 *                                 tightly.
 */

/** How the invite code is drawn. No vowels, and no characters that read as
 * each other in a message - 0/O, 1/I/L, 5/S, 8/B - because these get typed by
 * hand from a screenshot more often than they get tapped as a link. */
const CODE_ALPHABET = '23456789ACDEFGHJKMNPQRTVWXYZ';
const CODE_LENGTH = 6;

/** How many nudges one friend may send another in a day. A nudge is a poke,
 * and a poke that can arrive fifty times is harassment - the cap is what keeps
 * this a motivation feature rather than a way to make someone's phone
 * unusable. Enforced server-side in the rules too; this copy only exists so
 * the UI can grey the button out before the write fails. */
export const NUDGE_DAILY_LIMIT = 2;

/** The complete set of things one friend can say to another.
 *
 * Free text is not offered anywhere in this feature, and that is a design
 * decision rather than a shortcut: a fixed vocabulary cannot carry abuse, so
 * there is nothing to moderate, nothing to sanitise before it reaches a
 * notification body, and no way for a message to be anything other than
 * encouraging. The sender's name is prepended at delivery, which is what makes
 * a canned phrase feel personal.
 */
export const NUDGE_PHRASES = [
  { id: 'poke', text: 'nudged you' },
  { id: 'getafterit', text: 'says get after it' },
  { id: 'yourturn', text: "says it's your turn" },
  { id: 'catchup', text: 'is ahead of you today' },
  { id: 'proud', text: 'is proud of you' },
  { id: 'dontbreak', text: "says don't break the streak" },
] as const;

export type NudgePhraseId = (typeof NUDGE_PHRASES)[number]['id'];

export function phraseText(id: string): string {
  return NUDGE_PHRASES.find((p) => p.id === id)?.text ?? 'nudged you';
}

/** What a friend is allowed to see. Mirrors the public profile document. */
export interface PublicProfile {
  uid: string;
  name: string;
  /** Invite code, so the owner can show their own without a second read. */
  code?: string;
  /** How far round today's target, 0-100. */
  percent: number;
  streak: number;
  /** The user's local date the percent belongs to, YYYY-MM-DD. Without it a
   * friend in another timezone - or one who hasn't opened the app since
   * yesterday - would show last night's ring as if it were today's. */
  day: string;
  updatedAt: number;
}

export interface Friend extends PublicProfile {
  /** When the friendship was established, for stable ordering. */
  since: number;
}

export interface InboxItem {
  id: string;
  kind: 'request' | 'nudge';
  fromUid: string;
  fromName: string;
  /** Nudges only: which canned phrase was sent. */
  phrase?: string;
  createdAt: number;
}

function profileRef(uid: string) {
  return doc(cloudDb(), 'profiles', uid);
}

function friendsRef(uid: string) {
  return collection(cloudDb(), 'users', uid, 'friends');
}

function inboxRef(uid: string) {
  return collection(cloudDb(), 'users', uid, 'inbox');
}

function randomCode(): string {
  let out = '';
  const bytes = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(bytes);
  for (const b of bytes) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return out;
}

/** Claims a unique invite code for this account.
 *
 * The code has to be reversible - someone types it and we need the uid - so it
 * lives in its own top-level collection keyed by the code itself, which makes
 * the lookup a single document read rather than a query across every profile.
 *
 * Uniqueness is enforced by the transaction, not by hoping: two people
 * generating a code at the same moment can draw the same six characters, and
 * without the existence check the second would silently take over the first's
 * code and start receiving their friend requests. A few retries is plenty -
 * the space is 28^6, about 480 million.
 */
async function claimCode(uid: string): Promise<string> {
  const db = cloudDb();
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const ref = doc(db, 'inviteCodes', code);
    const taken = await runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists()) return true;
      tx.set(ref, { uid, createdAt: serverTimestamp() });
      return false;
    });
    if (!taken) return code;
  }
  throw new Error('Could not allocate an invite code. Try again.');
}

/** Publishes the shareable half of this account, creating the invite code on
 * first call.
 *
 * Called on every sync rather than only on change: the percent is a daily
 * figure, so a profile that isn't refreshed shows a friend yesterday's ring.
 * The write is one small document, which is why it can afford to be
 * unconditional.
 */
export async function publishProfile(
  uid: string,
  name: string,
  percent: number,
  streak: number,
  day: string
): Promise<PublicProfile> {
  const existing = await getDoc(profileRef(uid));
  const code = existing.exists() && existing.data().code
    ? (existing.data().code as string)
    : await claimCode(uid);

  const payload = {
    uid,
    name: name || 'Rungs user',
    code,
    percent: Math.max(0, Math.min(100, Math.round(percent))),
    streak: Math.max(0, Math.round(streak)),
    day,
    updatedAt: Date.now(),
  };
  await setDoc(profileRef(uid), { ...payload, syncedAt: serverTimestamp() }, { merge: true });
  return payload;
}

export async function myProfile(uid: string): Promise<PublicProfile | null> {
  const snap = await getDoc(profileRef(uid));
  if (!snap.exists()) return null;
  return snap.data() as PublicProfile;
}

/** Sends a friend request to whoever owns `code`.
 *
 * Deliberately writes into the recipient's inbox rather than creating the
 * friendship outright: being added to someone's list without a say is exactly
 * the thing an invite-code system is supposed to prevent, and the request is
 * the recipient's to accept. The sender's own side of the edge is not written
 * here either - it appears when they are accepted, so a pending request costs
 * nothing if it is ignored.
 */
export async function requestFriend(
  uid: string,
  myName: string,
  rawCode: string
): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  const code = rawCode.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (code.length !== CODE_LENGTH) {
    return { ok: false, reason: `An invite code is ${CODE_LENGTH} characters.` };
  }

  const codeSnap = await getDoc(doc(cloudDb(), 'inviteCodes', code));
  if (!codeSnap.exists()) return { ok: false, reason: "That code doesn't match anyone." };

  const targetUid = codeSnap.data().uid as string;
  if (targetUid === uid) return { ok: false, reason: "That's your own code." };

  const already = await getDoc(doc(friendsRef(uid), targetUid));
  if (already.exists()) return { ok: false, reason: "You're already friends." };

  const theirProfile = await getDoc(profileRef(targetUid));
  const theirName = theirProfile.exists()
    ? ((theirProfile.data().name as string) ?? 'Someone')
    : 'Someone';

  // Keyed by sender uid, so asking twice updates one request rather than
  // filling the recipient's inbox with copies of the same ask.
  await setDoc(doc(inboxRef(targetUid), `req_${uid}`), {
    kind: 'request',
    fromUid: uid,
    fromName: myName || 'Rungs user',
    createdAt: Date.now(),
    at: serverTimestamp(),
  });

  return { ok: true, name: theirName };
}

/** Accepts a request, writing both halves of the friendship.
 *
 * The recipient writes their own edge and the sender's, which is the one place
 * a user writes into another user's subtree. The rules permit it only for this
 * exact shape - a friends document naming the writer - because the alternative
 * is the sender polling to discover they were accepted, and a request that
 * needs both parties online to complete is a request that mostly doesn't.
 */
export async function acceptRequest(
  uid: string,
  myName: string,
  fromUid: string
): Promise<void> {
  const now = Date.now();
  const theirProfile = await getDoc(profileRef(fromUid));
  const theirName = theirProfile.exists()
    ? ((theirProfile.data().name as string) ?? 'Someone')
    : 'Someone';

  await setDoc(doc(friendsRef(uid), fromUid), {
    uid: fromUid, name: theirName, since: now,
  });
  await setDoc(doc(friendsRef(fromUid), uid), {
    uid, name: myName || 'Rungs user', since: now,
  });

  await deleteDoc(doc(inboxRef(uid), `req_${fromUid}`)).catch(() => {});

  // Tell them they're in, through the same inbox the nudge uses.
  await setDoc(doc(inboxRef(fromUid), `acc_${uid}`), {
    kind: 'nudge',
    fromUid: uid,
    fromName: myName || 'Rungs user',
    phrase: 'accepted',
    createdAt: now,
    at: serverTimestamp(),
  }).catch(() => {});
}

export async function declineRequest(uid: string, fromUid: string): Promise<void> {
  await deleteDoc(doc(inboxRef(uid), `req_${fromUid}`));
}

/** Removes a friendship from both sides.
 *
 * Both edges are deleted rather than only this user's, because a one-sided
 * removal would leave the other person able to keep nudging someone who has
 * removed them - the exact case the feature has to get right. */
export async function removeFriend(uid: string, friendUid: string): Promise<void> {
  await deleteDoc(doc(friendsRef(uid), friendUid));
  await deleteDoc(doc(friendsRef(friendUid), uid)).catch(() => {
    // Their side may already be gone if they removed us first.
  });
}

/** Reads a friend list, filling each entry from the friend's public profile.
 *
 * The edge stores a name copy so a friend still has a label when their profile
 * read fails or hasn't been published, but the profile is what's displayed
 * when present - otherwise a name changed after the friendship was made would
 * never update.
 */
export async function listFriends(uid: string): Promise<Friend[]> {
  const edges = await getDocs(friendsRef(uid));
  const friends = await Promise.all(edges.docs.map(async (edge) => {
    const data = edge.data();
    const fallback: Friend = {
      uid: edge.id,
      name: (data.name as string) ?? 'Someone',
      percent: 0,
      streak: 0,
      day: '',
      updatedAt: 0,
      since: (data.since as number) ?? 0,
    };
    try {
      const snap = await getDoc(profileRef(edge.id));
      if (!snap.exists()) return fallback;
      const p = snap.data() as PublicProfile;
      return { ...fallback, ...p, uid: edge.id, since: fallback.since };
    } catch {
      return fallback;
    }
  }));

  // Furthest along today first - the list is meant to be a leaderboard, and a
  // stable tiebreak on name keeps it from reshuffling as percentages tie.
  return friends.sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
}

/** Live inbox, so a request or nudge appears without the user refreshing. */
export function watchInbox(uid: string, fn: (items: InboxItem[]) => void): Unsubscribe {
  return onSnapshot(
    query(inboxRef(uid), orderBy('createdAt', 'desc'), fsLimit(50)),
    (snap) => {
      fn(snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          kind: (data.kind as InboxItem['kind']) ?? 'nudge',
          fromUid: (data.fromUid as string) ?? '',
          fromName: (data.fromName as string) ?? 'Someone',
          phrase: data.phrase as string | undefined,
          createdAt: (data.createdAt as number) ?? 0,
        };
      }));
    },
    () => {
      // Offline, or rules refused. An empty inbox is the right thing to show;
      // throwing here would take the whole Squad tab down with it.
      fn([]);
    }
  );
}

export async function dismissInbox(uid: string, id: string): Promise<void> {
  await deleteDoc(doc(inboxRef(uid), id)).catch(() => {});
}

/** The local date, used to key the daily nudge cap in the sender's own day. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** How many nudges this user has already sent that friend today. Read from the
 * sender's own subtree, which is what makes the count cheap and private. */
export async function nudgesSentToday(uid: string, friendUid: string): Promise<number> {
  const snap = await getDoc(doc(cloudDb(), 'users', uid, 'nudgeLog', `${today()}_${friendUid}`));
  return snap.exists() ? ((snap.data().count as number) ?? 0) : 0;
}

/** Sends a nudge, and refuses past the daily cap.
 *
 * The counter is written before the nudge rather than after. If the order were
 * reversed, a failure between the two would leave a delivered nudge that was
 * never counted, and the cap would be advisory - the direction to fail in is
 * the one that under-sends.
 */
export async function sendNudge(
  uid: string,
  myName: string,
  friendUid: string,
  phrase: NudgePhraseId
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const edge = await getDoc(doc(friendsRef(uid), friendUid));
  if (!edge.exists()) return { ok: false, reason: 'You are not friends with them.' };

  const logRef = doc(cloudDb(), 'users', uid, 'nudgeLog', `${today()}_${friendUid}`);
  const allowed = await runTransaction(cloudDb(), async (tx) => {
    const snap = await tx.get(logRef);
    const count = snap.exists() ? ((snap.data().count as number) ?? 0) : 0;
    if (count >= NUDGE_DAILY_LIMIT) return false;
    tx.set(logRef, { count: count + 1, day: today(), to: friendUid, at: serverTimestamp() });
    return true;
  });
  if (!allowed) {
    return { ok: false, reason: `You've nudged them ${NUDGE_DAILY_LIMIT} times today.` };
  }

  // Keyed by sender and phrase so a repeat nudge replaces rather than stacks -
  // the recipient sees the latest, not a pile.
  await setDoc(doc(inboxRef(friendUid), `nudge_${uid}`), {
    kind: 'nudge',
    fromUid: uid,
    fromName: myName || 'Rungs user',
    phrase,
    createdAt: Date.now(),
    at: serverTimestamp(),
  });

  return { ok: true };
}

/** Deletes everything this account put outside its own private subtree.
 *
 * Called from account deletion. Without it, deleting an account would leave
 * its public profile and invite code behind as orphans, and its friends
 * holding edges pointing at a user that no longer exists. */
export async function deleteFriendData(uid: string): Promise<void> {
  try {
    const edges = await getDocs(friendsRef(uid));
    for (const edge of edges.docs) {
      await deleteDoc(doc(friendsRef(edge.id), uid)).catch(() => {});
      await deleteDoc(edge.ref).catch(() => {});
    }

    const profile = await getDoc(profileRef(uid));
    if (profile.exists()) {
      const code = profile.data().code as string | undefined;
      if (code) await deleteDoc(doc(cloudDb(), 'inviteCodes', code)).catch(() => {});
    }
    await deleteDoc(profileRef(uid)).catch(() => {});

    const inbox = await getDocs(query(inboxRef(uid), fsLimit(200)));
    for (const item of inbox.docs) await deleteDoc(item.ref).catch(() => {});
  } catch {
    // Best-effort: the account deletion itself is what the user asked for and
    // must not fail because a leftover could not be swept.
  }
}

/** Whether a public profile's figures are from the user's current day. A ring
 * from yesterday is shown as zero rather than as today's progress. */
export function isToday(profile: PublicProfile): boolean {
  return profile.day === today();
}

export { today as localDay };
