'use client';
import { useEffect, useRef } from 'react';
import { Feedback } from './feedback';
export function FormFeedback({
  error,
  success,
  pending = false,
}: {
  error?: string;
  success?: string;
  pending?: boolean;
}) {
  const container = useRef<HTMLDivElement>(null);
  const submitted = useRef(false);
  useEffect(() => {
    if (pending) submitted.current = true;
    if (!pending && error && submitted.current) {
      container.current?.focus({ preventScroll: true });
      container.current?.scrollIntoView({ block: 'nearest' });
      submitted.current = false;
    }
  }, [error, pending]);
  if (pending || (!error && !success)) return null;
  return (
    <div ref={container} tabIndex={-1} className="form-feedback">
      <Feedback kind={error ? 'error' : 'success'}>{error || success}</Feedback>
    </div>
  );
}
