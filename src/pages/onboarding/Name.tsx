import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import Button from '../../components/Button';
import { getProfile } from '../../db';

const MAX_NAME = 24;

export default function Name() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getProfile().then((p) => { if (p?.name) setName(p.name); });
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= MAX_NAME;
  const error = touched && !valid
    ? trimmed.length === 0 ? 'We need something to call you.' : `Keep it under ${MAX_NAME} characters.`
    : null;

  const submit = () => {
    setTouched(true);
    if (!valid) return;
    navigate('/onboarding/baseline', { state: { name: trimmed } });
  };

  return (
    <div className="route-forward h-full overflow-y-auto flex flex-col px-5.5 pt-4 pb-action gap-4">
      <div className="flex items-center gap-3">
        <Button variant="icon" onClick={() => navigate('/onboarding/welcome')}><ChevronLeft size={18} /></Button>
        <div className="flex-1 h-[3px] rounded-full bg-text/12 overflow-hidden">
          <i className="block h-full bg-accent" style={{ width: '33%' }} />
        </div>
        <span className="text-[11px] text-neutral-500 flex-none">1 of 3</span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="text-[27px] font-medium tracking-[-0.02em]">What should we call you?</div>
        <div className="text-[13.5px] leading-[1.5] text-neutral-400">
          Just for the greeting on your dashboard. Nothing leaves your phone.
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <input
          ref={inputRef}
          type="text"
          value={name}
          maxLength={MAX_NAME + 10}
          placeholder="Your name"
          autoComplete="given-name"
          onChange={(e) => setName(e.target.value)}
          onBlur={() => setTouched(true)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          className="h-13 px-4 rounded-[13px] bg-surface shadow-sm text-[16px] text-text outline-none border border-transparent focus-visible:border-accent placeholder:text-neutral-600"
        />
        {error && <span className="text-[11.5px] text-red-300 px-1">{error}</span>}
      </div>

      <div className="mt-auto">
        <Button variant="primary" block className="h-12 text-[15px]" disabled={!valid} onClick={submit}>
          Continue
        </Button>
      </div>
    </div>
  );
}
