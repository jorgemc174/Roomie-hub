'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

export type SectionTab = { href: string; label: string; current: boolean };

export function SectionTabs({ label, items }: { label: string; items: SectionTab[] }) {
  const nav = useRef<HTMLElement>(null);
  const activeHref = items.find((item) => item.current)?.href;
  useEffect(() => {
    const container = nav.current;
    const active = container?.querySelector<HTMLElement>('[aria-current]');
    if (container && active)
      container.scrollLeft = active.offsetLeft - (container.clientWidth - active.offsetWidth) / 2;
  }, [activeHref]);
  return (
    <nav className="section-tabs" aria-label={label} ref={nav}>
      {items.map(({ href, label, current }) => (
        <Link key={href} href={href} aria-current={current ? 'page' : undefined}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
