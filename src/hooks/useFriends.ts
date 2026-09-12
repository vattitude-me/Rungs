import { useCallback, useEffect, useState } from 'react';
import { useCloudSync } from './useCloudSync';
import type { Friend, InboxItem, PublicProfile, NudgePhraseId } from '../cloud/friends';

/** Squad's data, loaded on demand.
 *
 * The Firestore imports are dynamic throughout. `cloud/friends` pulls in the
 * Firestore SDK, and Squad is a tab most users open rarely - static imports
 * here would put that weight into the main bundle for everyone, including
 * people who never sign in. The same reasoning is why `useCloudSync` loads its
 * modules lazily.
 */

const friendsModule = () => import('../cloud/friends');

/** Creates the shareable profile, and so the invite code, on first need.
 *
 * The figures are deliberately zeroed rather than recomputed from the local
 * tables: the sync pass owns that calculation and will overwrite these within
 * the same session. What matters here is that the code exists, since it is the
 * only thing a user cannot obtain any other way.
 */
async function ensureProfile(
  uid: string,
  myName: string,
  m: Awaited<ReturnType<typeof friendsModule>>,
) {
  return m.publishProfile(uid, myName, 0, 0, m.localDay());
}

export interface FriendsState {
  /** Undefined until the first load finishes, so the UI can tell "loading"
   * from "no friends yet" - they want very different screens. */
  friends: Friend[] | undefined;
  inbox: InboxItem[];
  /** This user's own public profile, which carries their invite code. */
  me: PublicProfile | null;
  error: string | null;
  refresh: () => Promise<void>;
  addFriend: (code: string) => Promise<{ ok: boolean; message: string }>;
  accept: (fromUid: string) => Promise<void>;
  decline: (fromUid: string) => Promise<void>;
  remove: (friendUid: string) => Promise<void>;
  nudge: (friendUid: string, phrase: NudgePhraseId) => Promise<{ ok: boolean; message: string }>;
  dismiss: (id: string) => Promise<void>;
}

export function useFriends(myName: string): FriendsState {
  const { account } = useCloudSync();
  const [friends, setFriends] = useState<Friend[] | undefined>(undefined);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [me, setMe] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  const uid = account?.uid;

  const refresh = useCallback(async () => {
    if (!uid) {
      setFriends(undefined);
      setMe(null);
      return;
    }
    try {
      const m = await friendsModule();
      const [list, mine] = await Promise.all([m.listFriends(uid), m.myProfile(uid)]);
      setFriends(list);
      setError(null);

      // A profile is normally published by the sync pass, but Squad is
      // reachable before one has run. myProfile only reads, so until that pass
      // happens there is no invite code, and the UI can only show a row of
      // dots the user cannot copy or act on.
      //
      // Only when the name has loaded, though: Squad reads it from the local
      // profile asynchronously, so publishing on the first pass would claim
      // the code under the "Rungs user" fallback and leave a friend looking at
      // a request from nobody. A missing name means "not ready yet", not
      // "unnamed" - the sync pass remains the backstop either way.
      if (mine) {
        setMe(mine);
      } else if (myName) {
        setMe(await ensureProfile(uid, myName, m));
      }
    } catch (e) {
      // An empty list would read as "you have no friends", which is a
      // different and wrong statement when the truth is that the read failed.
      setFriends([]);
      setError((e as Error).message);
    }
  }, [uid, myName]);

  useEffect(() => { void refresh(); }, [refresh]);

  // The inbox is live rather than polled: a friend request that only appears
  // on the next manual refresh is one the user assumes never arrived.
  useEffect(() => {
    if (!uid) {
      setInbox([]);
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    void friendsModule().then((m) => {
      if (cancelled) return;
      stop = m.watchInbox(uid, setInbox);
    });
    return () => { cancelled = true; stop?.(); };
  }, [uid]);

  const addFriend = useCallback(async (code: string) => {
    if (!uid) return { ok: false, message: 'Sign in first.' };
    try {
      const m = await friendsModule();
      const result = await m.requestFriend(uid, myName, code);
      if (!result.ok) return { ok: false, message: result.reason };
      return { ok: true, message: `Request sent to ${result.name}.` };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }, [uid, myName]);

  const accept = useCallback(async (fromUid: string) => {
    if (!uid) return;
    const m = await friendsModule();
    await m.acceptRequest(uid, myName, fromUid);
    await refresh();
  }, [uid, myName, refresh]);

  const decline = useCallback(async (fromUid: string) => {
    if (!uid) return;
    await (await friendsModule()).declineRequest(uid, fromUid);
  }, [uid]);

  const remove = useCallback(async (friendUid: string) => {
    if (!uid) return;
    await (await friendsModule()).removeFriend(uid, friendUid);
    await refresh();
  }, [uid, refresh]);

  const nudge = useCallback(async (friendUid: string, phrase: NudgePhraseId) => {
    if (!uid) return { ok: false, message: 'Sign in first.' };
    try {
      const m = await friendsModule();
      const result = await m.sendNudge(uid, myName, friendUid, phrase);
      return result.ok
        ? { ok: true, message: 'Sent.' }
        : { ok: false, message: result.reason };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }, [uid, myName]);

  const dismiss = useCallback(async (id: string) => {
    if (!uid) return;
    await (await friendsModule()).dismissInbox(uid, id);
  }, [uid]);

  return { friends, inbox, me, error, refresh, addFriend, accept, decline, remove, nudge, dismiss };
}
