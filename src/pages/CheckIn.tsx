import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Gauge } from 'lucide-react';
import Button from '../components/Button';
import BodyFields, { bodyDraftFrom, parseBody, type BodyDraft } from '../components/BodyFields';
import { getProfile, saveProfile } from '../db';
import { localDate } from '../engine/dates';
import type { Profile } from '../types';

const MAX_NAME = 24;

/**
 * The questions onboarding deliberately didn't ask.
 *
 * Asked the day after, once someone has done a set or two and has a reason
 * to care: a name for the greeting and the squad, a weight for the calorie
 * and weight-lifted numbers, and - if the plan is still running on the
 * level-picker estimate - the offer of a real test. All of it optional.
 */
export default function CheckIn() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState('');
  const [body, setBody] = useState<BodyDraft>({ units: 'metric', weight: '', height: '' });
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile().then((p) => {
      if (!p) return;
      setProfile(p);
      setName(p.name);
      setBody(bodyDraftFrom(p));
    });
  }, []);

  if (!profile) return null;

  const parsed = parseBody(body);

  const save = async (then: string) => {
    setTouched(true);
    if (!parsed.ok || saving) return;
    setSaving(true);
    const next: Profile = {
      ...profile,
      name: name.trim().slice(0, MAX_NAME),
      units: body.units,
      weightKg: parsed.weightKg,
      heightCm: parsed.heightCm,
      checkInDoneAt: localDate(),
    };
    await saveProfile(next);
    navigate(then, { replace: true });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-5">
      <div className="flex items-center gap-3">
        <Button variant="icon" aria-label="Back" onClick={() => navigate(-1)}><ChevronLeft size={18} /></Button>
        <span className="text-[11px] tracking-[0.14em] text-accent">QUICK CHECK-IN</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-[27px] leading-[1.12] font-semibold tracking-[-0.025em]">Let's make it fit you</h1>
        <p className="text-[13.5px] leading-[1.5] text-neutral-400">Everything here is optional. Fill in what's useful.</p>
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] tracking-[0.1em] text-neutral-500">WHAT SHOULD WE CALL YOU?</h2>
        <input
          type="text"
          value={name}
          maxLength={MAX_NAME + 6}
          placeholder="Your first name"
          autoComplete="given-name"
          onChange={(e) => setName(e.target.value)}
          className="h-12 px-4 rounded-[12px] bg-surface shadow-sm text-[16px] text-text outline-none border border-transparent focus-visible:border-accent placeholder:text-neutral-600"
        />
        <span className="text-[11px] text-neutral-600">For your greeting, and what friends see in your squad.</span>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-[11px] tracking-[0.1em] text-neutral-500">YOUR BODY</h2>
        <div className="p-3.5 rounded-[15px] bg-surface shadow-sm">
          <BodyFields value={body} onChange={setBody} showErrors={touched} />
        </div>
      </section>

      {profile.maxesEstimated && (
        <button
          type="button"
          onClick={() => void save('/settings/retest')}
          className="flex items-center gap-3 p-3.5 rounded-[15px] bg-accent-900 text-left cursor-pointer"
        >
          <Gauge size={18} className="text-accent-200 flex-none" />
          <span className="flex-1 flex flex-col gap-0.5">
            <span className="text-[13.5px] font-medium text-accent-100">Your numbers are an estimate</span>
            <span className="text-[12px] leading-[1.4] text-accent-200">Two minutes of testing makes every set the right size.</span>
          </span>
          <span className="text-accent-200">›</span>
        </button>
      )}

      <div className="mt-auto">
        <Button variant="solid" block className="h-13 text-[15.5px] rounded-[14px]" disabled={saving} onClick={() => void save('/today')}>
          Save
        </Button>
      </div>
    </div>
  );
}
