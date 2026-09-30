import ModeChip from './ModeChip';
import { displayToKg, kgToDisplay } from '../engine/energy';
import type { Units } from '../types';

export interface BodyDraft {
  units: Units;
  weight: string;
  height: string;
}

const CM_PER_IN = 2.54;

export function bodyDraftFrom(p: { units?: Units; weightKg?: number; heightCm?: number }): BodyDraft {
  const units = p.units ?? 'metric';
  return {
    units,
    weight: p.weightKg ? String(Math.round(kgToDisplay(p.weightKg, units))) : '',
    height: p.heightCm ? String(Math.round(units === 'imperial' ? p.heightCm / CM_PER_IN : p.heightCm)) : '',
  };
}

/** Parses the draft. Blank is allowed and means "not given"; anything else
 * outside a plausible human range is rejected rather than stored. */
export function parseBody(d: BodyDraft): { ok: boolean; weightKg?: number; heightCm?: number } {
  const w = d.weight.trim() ? Number(d.weight) : undefined;
  const h = d.height.trim() ? Number(d.height) : undefined;
  const weightKg = w === undefined ? undefined : displayToKg(w, d.units);
  const heightCm = h === undefined ? undefined : d.units === 'imperial' ? h * CM_PER_IN : h;
  const okW = weightKg === undefined || (Number.isFinite(weightKg) && weightKg >= 25 && weightKg <= 300);
  const okH = heightCm === undefined || (Number.isFinite(heightCm) && heightCm >= 100 && heightCm <= 250);
  return { ok: okW && okH, weightKg, heightCm };
}

const UNIT_OPTIONS: { key: Units; label: string }[] = [
  { key: 'metric', label: 'kg · cm' },
  { key: 'imperial', label: 'lb · in' },
];

interface BodyFieldsProps {
  value: BodyDraft;
  onChange: (d: BodyDraft) => void;
  showErrors?: boolean;
}

/** Weight and height, in either unit system. Switching units converts what's
 * already typed rather than clearing it. */
export default function BodyFields({ value, onChange, showErrors }: BodyFieldsProps) {
  const parsed = parseBody(value);
  const switchUnits = (units: Units) => {
    if (units === value.units) return;
    const next = bodyDraftFrom({ units, weightKg: parsed.weightKg, heightCm: parsed.heightCm });
    onChange(next);
  };
  const imperial = value.units === 'imperial';
  const input = 'w-full h-12 px-3.5 rounded-[12px] bg-bg text-[16px] tabular-nums text-text outline-none border border-transparent focus-visible:border-accent';

  return (
    <div className="flex flex-col gap-2.5">
      <ModeChip options={UNIT_OPTIONS} value={value.units} onChange={switchUnits} />
      <div className="flex gap-2.5">
        <label className="flex-1 flex flex-col gap-1.25">
          <span className="text-[11.5px] text-neutral-500">Weight ({imperial ? 'lb' : 'kg'})</span>
          <input
            type="number" inputMode="decimal" placeholder={imperial ? '165' : '75'}
            value={value.weight}
            onChange={(e) => onChange({ ...value, weight: e.target.value })}
            className={input}
          />
        </label>
        <label className="flex-1 flex flex-col gap-1.25">
          <span className="text-[11.5px] text-neutral-500">Height ({imperial ? 'in' : 'cm'}) · optional</span>
          <input
            type="number" inputMode="decimal" placeholder={imperial ? '69' : '175'}
            value={value.height}
            onChange={(e) => onChange({ ...value, height: e.target.value })}
            className={input}
          />
        </label>
      </div>
      {showErrors && !parsed.ok && (
        <span className="text-[11.5px] text-danger-soft">Those numbers look off. Double-check the units.</span>
      )}
      <span className="text-[11px] leading-[1.5] text-neutral-600">
        Used only for calorie and weight-lifted estimates. Stays on your device unless you sync.
      </span>
    </div>
  );
}
