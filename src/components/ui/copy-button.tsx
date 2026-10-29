'use client';
import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
export function CopyButton({
  text,
  label,
  copiedLabel,
  errorLabel,
}: {
  text: string;
  label: string;
  copiedLabel: string;
  errorLabel: string;
}) {
  const [result, setResult] = useState<{ text: string; status: 'idle' | 'copied' | 'error' }>({
    text: '',
    status: 'idle',
  });
  const status = result.text === text ? result.status : 'idle';
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setResult({ text, status: 'copied' });
    } catch {
      setResult({ text, status: 'error' });
    }
  }
  return (
    <div className="copy-action">
      <button className="button secondary" type="button" onClick={() => void copy()}>
        {status === 'copied' ? (
          <Check size={18} aria-hidden="true" />
        ) : (
          <Copy size={18} aria-hidden="true" />
        )}
        {status === 'copied' ? copiedLabel : label}
      </button>
      <span className={status === 'error' ? 'notice error' : 'sr-only'} role="status">
        {status === 'error' ? errorLabel : status === 'copied' ? copiedLabel : ''}
      </span>
    </div>
  );
}
