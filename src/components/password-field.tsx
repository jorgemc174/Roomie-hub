'use client';
import { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

export function PasswordField({
  label,
  showLabel,
  hideLabel,
  autoComplete,
  minLength,
  hint,
}: {
  label: string;
  showLabel: string;
  hideLabel: string;
  autoComplete: string;
  minLength: number;
  hint?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <label htmlFor={id}>{label}</label>
      <div className="password-input">
        <input
          id={id}
          name="password"
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          minLength={minLength}
          maxLength={128}
          required
          aria-describedby={hint ? `${id}-hint` : undefined}
        />
        <button
          type="button"
          aria-label={visible ? hideLabel : showLabel}
          aria-controls={id}
          onClick={() => setVisible(!visible)}
        >
          {visible ? <EyeOff size={20} aria-hidden="true" /> : <Eye size={20} aria-hidden="true" />}
        </button>
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
