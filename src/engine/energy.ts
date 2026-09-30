import type { SetLog, Units } from '../types';
import { CLASSIC, movementById, type Movement } from '../data/movements';

/** Calorie and "weight moved" estimates.
 *
 * Both are honest approximations and the UI says so. Calories use the
 * standard MET formula - kcal/min = MET x 3.5 x kg / 200 - over the time the
 * reps actually take. Short bodyweight sets are known to be undercounted by
 * MET tables, so this errs low rather than flattering anyone.
 *
 * Weight moved is reps x bodyweight x the share of it each movement lifts
 * (about 64% for a push-up, all of it for a pull-up). It is the bigger, more
 * motivating number, and it grows with strength rather than with sweat.
 */

function movementOfLog(log: SetLog): Movement {
  return movementById(log.variation) ?? movementById(CLASSIC[log.exercise])!;
}

export function caloriesFor(reps: number, m: Movement, weightKg: number): number {
  const minutes = (reps * m.secPerRep) / 60;
  return (m.met * 3.5 * weightKg / 200) * minutes;
}

export function kgMovedFor(reps: number, m: Movement, weightKg: number): number {
  return m.load === null ? 0 : reps * m.load * weightKg;
}

export interface EnergyTotals {
  kcal: number;
  kgMoved: number;
}

export function totalsForLogs(logs: SetLog[], weightKg: number): EnergyTotals {
  let kcal = 0;
  let kgMoved = 0;
  for (const log of logs) {
    const m = movementOfLog(log);
    kcal += caloriesFor(log.reps, m, weightKg);
    kgMoved += kgMovedFor(log.reps, m, weightKg);
  }
  return { kcal, kgMoved };
}

export function totalsForReps(reps: number, m: Movement, weightKg: number): EnergyTotals {
  return { kcal: caloriesFor(reps, m, weightKg), kgMoved: kgMovedFor(reps, m, weightKg) };
}

const LB_PER_KG = 2.20462;

export function kgToDisplay(kg: number, units: Units): number {
  return units === 'imperial' ? kg * LB_PER_KG : kg;
}

export function displayToKg(value: number, units: Units): number {
  return units === 'imperial' ? value / LB_PER_KG : value;
}

/** "1.2 t" / "640 kg" / "2,650 lb" - weight moved, sized to read at a glance. */
export function formatMoved(kg: number, units: Units): string {
  if (units === 'imperial') {
    const lb = kg * LB_PER_KG;
    return lb >= 10_000 ? `${(lb / 2000).toFixed(1)} tons` : `${Math.round(lb).toLocaleString()} lb`;
  }
  return kg >= 1000 ? `${(kg / 1000).toFixed(1)} t` : `${Math.round(kg)} kg`;
}

export function formatKcal(kcal: number): string {
  return `${Math.round(kcal).toLocaleString()} kcal`;
}
