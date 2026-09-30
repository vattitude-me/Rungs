import type { Equipment, Exercise, FitnessLevel, Profile } from '../types';

/** One way of filling a slot.
 *
 * A day is still made of three slots - push, pull, legs - because the plan,
 * the history and the squad all count reps per slot. What changes is the
 * movement that fills each one: knee push-ups and archer push-ups are both
 * "push", and a set of either banks against the same target. That keeps the
 * daily number simple while letting people train the way they like.
 *
 * We don't try to be an encyclopaedia. Each movement carries one line of cue
 * and a Wikipedia link for anyone who wants the long version.
 */
export interface Movement {
  id: string;
  slot: Exercise;
  /** Title case, for headings: "Knee push-ups". */
  name: string;
  /** One line: the thing to get right. */
  cue: string;
  /** 1 (easiest) to 6. Drives the default pick and the difficulty dots. */
  level: number;
  /** Kit it needs. Empty means bodyweight only. */
  needs: Equipment[];
  /** Share of bodyweight moved per rep, for "weight moved". Rough, taken from
   * the usual force-plate figures (a push-up is about 64%). Null for loaded
   * movements, where it depends on a weight we don't ask for. */
  load: number | null;
  /** Compendium-style MET for the effort, used for the calorie estimate. */
  met: number;
  /** Typical seconds per rep at a controlled tempo. */
  secPerRep: number;
  /** Wikipedia article title. */
  wiki: string;
  /** Our own demo footage, only for the three classics. */
  video?: string;
}

const M = (m: Movement) => m;

export const MOVEMENTS: Movement[] = [
  // Push
  M({ id: 'wall-push', slot: 'push', name: 'Wall push-ups', cue: 'Hands on a wall at chest height, body in one straight line.', level: 1, needs: [], load: 0.3, met: 2.8, secPerRep: 2.5, wiki: 'Push-up' }),
  M({ id: 'incline-push', slot: 'push', name: 'Incline push-ups', cue: 'Hands on a counter or bench. Lower the surface as you get stronger.', level: 2, needs: [], load: 0.41, met: 3.3, secPerRep: 2.5, wiki: 'Push-up' }),
  M({ id: 'knee-push', slot: 'push', name: 'Knee push-ups', cue: 'Knees down, hips in line with shoulders. Chest to the floor.', level: 2, needs: [], load: 0.49, met: 3.3, secPerRep: 2.5, wiki: 'Push-up' }),
  M({ id: 'push-up', slot: 'push', name: 'Push-ups', cue: 'Hands under shoulders, body rigid, chest nearly touching the floor.', level: 3, needs: [], load: 0.64, met: 3.8, secPerRep: 2.5, wiki: 'Push-up', video: '/videos/push.mp4' }),
  M({ id: 'wide-push', slot: 'push', name: 'Wide push-ups', cue: 'Hands a palm-width wider than shoulders. More chest, less triceps.', level: 3, needs: [], load: 0.64, met: 3.8, secPerRep: 2.5, wiki: 'Push-up' }),
  M({ id: 'diamond-push', slot: 'push', name: 'Diamond push-ups', cue: 'Thumbs and index fingers touching under your chest. Elbows in.', level: 4, needs: [], load: 0.66, met: 4, secPerRep: 2.8, wiki: 'Push-up' }),
  M({ id: 'decline-push', slot: 'push', name: 'Decline push-ups', cue: 'Feet up on a chair or step. Keep the hips from sagging.', level: 4, needs: [], load: 0.7, met: 4, secPerRep: 2.8, wiki: 'Push-up' }),
  M({ id: 'pike-push', slot: 'push', name: 'Pike push-ups', cue: 'Hips high in an upside-down V, head travels toward the floor.', level: 4, needs: [], load: 0.7, met: 4, secPerRep: 3, wiki: 'Pike push-up' }),
  M({ id: 'archer-push', slot: 'push', name: 'Archer push-ups', cue: 'Wide hands, shift onto one arm while the other stays straight.', level: 5, needs: [], load: 0.75, met: 4.5, secPerRep: 3.2, wiki: 'Push-up' }),
  M({ id: 'db-floor-press', slot: 'push', name: 'Dumbbell floor press', cue: 'On your back, elbows touch the floor, press straight up.', level: 3, needs: ['dumbbell'], load: null, met: 3.5, secPerRep: 2.8, wiki: 'Bench press' }),
  M({ id: 'db-shoulder-press', slot: 'push', name: 'Dumbbell shoulder press', cue: 'Standing tall, press overhead without leaning back.', level: 3, needs: ['dumbbell'], load: null, met: 3.5, secPerRep: 2.8, wiki: 'Overhead press' }),

  // Pull
  M({ id: 'superman', slot: 'pull', name: 'Supermans', cue: 'Face down, lift chest and legs, squeeze shoulder blades together.', level: 1, needs: [], load: 0.2, met: 2.8, secPerRep: 3, wiki: 'Hyperextension (exercise)' }),
  M({ id: 'table-row', slot: 'pull', name: 'Table rows', cue: 'Under a sturdy table, pull your chest to the edge, body straight.', level: 2, needs: [], load: 0.5, met: 3.5, secPerRep: 3, wiki: 'Inverted row' }),
  M({ id: 'band-row', slot: 'pull', name: 'Band rows', cue: 'Band anchored at chest height, elbows back past your ribs.', level: 2, needs: ['band'], load: null, met: 3, secPerRep: 2.8, wiki: 'Resistance band' }),
  M({ id: 'db-row', slot: 'pull', name: 'Dumbbell rows', cue: 'One hand on a chair, pull the weight to your hip, not your chest.', level: 2, needs: ['dumbbell'], load: null, met: 3.5, secPerRep: 2.8, wiki: 'Bent-over row' }),
  M({ id: 'negative-pull', slot: 'pull', name: 'Pull-up negatives', cue: 'Jump to the top, lower yourself as slowly as you can.', level: 3, needs: ['bar'], load: 1, met: 4, secPerRep: 5, wiki: 'Pull-up (exercise)' }),
  M({ id: 'band-pull', slot: 'pull', name: 'Band-assisted pull-ups', cue: 'Band looped on the bar under your foot takes some of the weight.', level: 3, needs: ['bar', 'band'], load: 0.7, met: 4, secPerRep: 3.2, wiki: 'Pull-up (exercise)' }),
  M({ id: 'chin-up', slot: 'pull', name: 'Chin-ups', cue: 'Palms facing you, chin over the bar, all the way down each rep.', level: 4, needs: ['bar'], load: 1, met: 4.5, secPerRep: 3.2, wiki: 'Chin-up' }),
  M({ id: 'pull-up', slot: 'pull', name: 'Pull-ups', cue: 'Palms away, from a dead hang until your chin clears the bar.', level: 4, needs: ['bar'], load: 1, met: 4.5, secPerRep: 3.2, wiki: 'Pull-up (exercise)', video: '/videos/pull.mp4' }),
  M({ id: 'wide-pull', slot: 'pull', name: 'Wide pull-ups', cue: 'Hands well past shoulder-width. Pull the bar toward your collarbone.', level: 5, needs: ['bar'], load: 1, met: 5, secPerRep: 3.4, wiki: 'Pull-up (exercise)' }),

  // Legs
  M({ id: 'glute-bridge', slot: 'squat', name: 'Glute bridges', cue: 'On your back, knees bent, drive hips up until knees-hips-shoulders line up.', level: 1, needs: [], load: 0.5, met: 3, secPerRep: 2.5, wiki: 'Hip thrust' }),
  M({ id: 'chair-squat', slot: 'squat', name: 'Chair squats', cue: 'Sit back until you brush the chair, then stand without using your hands.', level: 1, needs: [], load: 0.6, met: 4, secPerRep: 2.5, wiki: 'Squat (exercise)' }),
  M({ id: 'squat', slot: 'squat', name: 'Squats', cue: 'Feet shoulder-width, chest up, hips below knees if you can.', level: 2, needs: [], load: 0.7, met: 5, secPerRep: 2.2, wiki: 'Squat (exercise)', video: '/videos/squat.mp4' }),
  M({ id: 'sumo-squat', slot: 'squat', name: 'Sumo squats', cue: 'Wide stance, toes out, knees track over the toes.', level: 2, needs: [], load: 0.7, met: 5, secPerRep: 2.2, wiki: 'Squat (exercise)' }),
  M({ id: 'reverse-lunge', slot: 'squat', name: 'Reverse lunges', cue: 'Step back, back knee kisses the floor. Count each leg as a rep.', level: 3, needs: [], load: 0.7, met: 4, secPerRep: 2.5, wiki: 'Lunge (exercise)' }),
  M({ id: 'jump-squat', slot: 'squat', name: 'Jump squats', cue: 'Squat, then jump. Land soft and sink straight into the next one.', level: 4, needs: [], load: 0.75, met: 8, secPerRep: 2, wiki: 'Squat (exercise)' }),
  M({ id: 'bulgarian', slot: 'squat', name: 'Bulgarian split squats', cue: 'Back foot on a chair, drop straight down. Count each leg as a rep.', level: 4, needs: [], load: 0.8, met: 5, secPerRep: 3, wiki: 'Split squat' }),
  M({ id: 'shrimp-squat', slot: 'squat', name: 'Shrimp squats', cue: 'Hold one foot behind you, lower until that knee touches down.', level: 5, needs: [], load: 0.9, met: 5.5, secPerRep: 3.4, wiki: 'Squat (exercise)' }),
  M({ id: 'pistol', slot: 'squat', name: 'Pistol squats', cue: 'One leg, other straight out front, all the way down and back up.', level: 6, needs: [], load: 0.95, met: 6, secPerRep: 3.6, wiki: 'Pistol squat' }),
  M({ id: 'goblet-squat', slot: 'squat', name: 'Goblet squats', cue: 'Dumbbell held at your chest, elbows inside the knees at the bottom.', level: 2, needs: ['dumbbell'], load: null, met: 5, secPerRep: 2.5, wiki: 'Goblet squat' }),
  M({ id: 'db-rdl', slot: 'squat', name: 'Dumbbell Romanian deadlifts', cue: 'Soft knees, push hips back, weights slide down your thighs.', level: 3, needs: ['dumbbell'], load: null, met: 4.5, secPerRep: 3, wiki: 'Romanian deadlift' }),
];

const BY_ID = new Map(MOVEMENTS.map((m) => [m.id, m]));

/** The movement each slot started life as. Also what an old set log with no
 * `variation` was done as. */
export const CLASSIC: Record<Exercise, string> = { push: 'push-up', pull: 'pull-up', squat: 'squat' };

export function movementById(id: string | undefined): Movement | undefined {
  return id ? BY_ID.get(id) : undefined;
}

export function wikipediaUrl(m: Movement): string {
  return `https://en.wikipedia.org/wiki/Special:Search?search=${encodeURIComponent(m.wiki)}`;
}

export function canDo(m: Movement, equipment: Equipment[]): boolean {
  return m.needs.every((n) => equipment.includes(n));
}

/** Every movement for a slot the user has the kit for, easiest first. */
export function movementsFor(slot: Exercise, equipment: Equipment[]): Movement[] {
  return MOVEMENTS
    .filter((m) => m.slot === slot && canDo(m, equipment))
    .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
}

/** What someone at this max, with this kit, should start on.
 *
 * Maxes are measured on the classic movement, so they say how far up or down
 * the ladder to start. Pull is the interesting one: no bar means rows (loaded
 * ones if there's a dumbbell), and a bar with no pull-up yet means negatives -
 * the fastest route to a first rep. */
export function suggestMovement(slot: Exercise, max: number, equipment: Equipment[]): Movement {
  const pick = (id: string) => BY_ID.get(id)!;
  if (slot === 'push') {
    if (max <= 0) return pick('wall-push');
    if (max < 5) return pick('incline-push');
    return pick('push-up');
  }
  if (slot === 'pull') {
    if (!equipment.includes('bar')) {
      if (equipment.includes('dumbbell')) return pick('db-row');
      if (equipment.includes('band')) return pick('band-row');
      return pick('table-row');
    }
    if (max <= 0) return pick('negative-pull');
    if (max < 3) return equipment.includes('band') ? pick('band-pull') : pick('negative-pull');
    return pick('pull-up');
  }
  if (max < 10) return pick('chair-squat');
  return pick('squat');
}

/** Profiles from before equipment existed only knew whether there was a bar. */
export function equipmentOf(profile: Pick<Profile, 'equipment' | 'barAccess' | 'rowEquipment'>): Equipment[] {
  if (profile.equipment) return profile.equipment;
  const kit: Equipment[] = [];
  if (profile.barAccess !== 'none') kit.push('bar');
  if (profile.rowEquipment === 'dumbbell') kit.push('dumbbell');
  if (profile.rowEquipment === 'band') kit.push('band');
  return kit;
}

/** The movement this profile does for a slot: their pick if they made one
 * and still have the kit for it, otherwise the suggestion for their level. */
export function movementFor(profile: Profile, slot: Exercise): Movement {
  const kit = equipmentOf(profile);
  const chosen = movementById(profile.variations?.[slot]);
  if (chosen && chosen.slot === slot && canDo(chosen, kit)) return chosen;
  // Profiles from before movement choice keep doing exactly what they were
  // doing - an update shouldn't quietly swap someone's push-ups for incline.
  if (!profile.equipment) return legacyMovement(profile, slot);
  return suggestMovement(slot, profile.maxes[slot] ?? 0, kit);
}

/** What a pre-2.0 profile was doing: the classics, with pull read off the old
 * pull-up rung. */
function legacyMovement(profile: Profile, slot: Exercise): Movement {
  const pick = (id: string) => BY_ID.get(id)!;
  if (slot !== 'pull') return pick(CLASSIC[slot]);
  switch (profile.pullRung) {
    case 0:
      return profile.rowEquipment === 'dumbbell' || profile.rowEquipment === 'kettlebell' ? pick('db-row')
        : profile.rowEquipment === 'band' ? pick('band-row')
          : pick('table-row');
    case 1: return pick('negative-pull');
    case 2: return pick('band-pull');
    default: return pick('pull-up');
  }
}

/** "12 knee push-ups" - a count with the movement, for summaries. */
export function repsOf(reps: number, m: Movement): string {
  return `${reps} ${m.name.toLowerCase()}`;
}

/** Starting maxes for each self-assessed level. Deliberately on the modest
 * side: a plan that feels easy on day one gets done, and the check-in the
 * next day offers a real test. */
export const LEVEL_MAXES: Record<FitnessLevel, Record<Exercise, number>> = {
  new: { push: 3, pull: 0, squat: 12 },
  returning: { push: 10, pull: 2, squat: 25 },
  active: { push: 20, pull: 6, squat: 40 },
  strong: { push: 35, pull: 12, squat: 60 },
};

export const LEVELS: { id: FitnessLevel; title: string; sub: string }[] = [
  { id: 'new', title: 'Just starting', sub: 'A few push-ups, no pull-ups yet' },
  { id: 'returning', title: 'Getting back into it', sub: 'Around 10 push-ups, maybe a pull-up' },
  { id: 'active', title: 'Pretty active', sub: 'About 20 push-ups and a handful of pull-ups' },
  { id: 'strong', title: 'Already strong', sub: '30+ push-ups, 10+ pull-ups' },
];

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  bar: 'Pull-up bar',
  dumbbell: 'Dumbbells',
  band: 'Resistance band',
};
