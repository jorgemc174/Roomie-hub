'use client';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

export function ViewFilter({
  label,
  value,
  options,
}: {
  label: string;
  value: string;
  options: { href: string; label: string }[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <label className="view-filter" aria-busy={pending}>
      <span className="sr-only">{label}</span>
      <select
        value={value}
        disabled={pending}
        onChange={(event) => {
          const href = event.target.value;
          startTransition(() => router.push(href, { scroll: false }));
        }}
      >
        {options.map(({ href, label }) => (
          <option key={href} value={href}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}
