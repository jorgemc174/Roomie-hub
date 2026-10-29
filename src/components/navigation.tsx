'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { House, CalendarDays, ListTodo, Wallet, Heart, MessageCircle } from 'lucide-react';
import type { Messages } from '@/lib/i18n/dictionaries';
export const modules = [
  { key: 'calendar', icon: CalendarDays },
  { key: 'organization', icon: ListTodo },
  { key: 'expenses', icon: Wallet },
  { key: 'community', icon: Heart },
  { key: 'chat', icon: MessageCircle },
] as const;
export function Navigation({ homeId, t }: { homeId: string; t: Messages }) {
  const pathname = usePathname();
  return (
    <nav className="side-nav" aria-label={t.home}>
      {[{ key: 'home', icon: House } as const, ...modules].map(({ key, icon: Icon }) => {
        const href = `/homes/${homeId}${key === 'home' ? '' : `/${key}`}`;
        const active = pathname === href || (key !== 'home' && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={key}
            href={href}
            className={active ? 'active' : ''}
            aria-label={t[key]}
            aria-current={active ? (pathname === href ? 'page' : 'location') : undefined}
          >
            <Icon size={21} aria-hidden="true" />
            <span className="nav-label">
              {
                t[
                  key as keyof Pick<
                    Messages,
                    'home' | 'calendar' | 'organization' | 'expenses' | 'community' | 'chat'
                  >
                ]
              }
            </span>
            <span className="nav-label-mobile" aria-hidden="true">
              {key === 'calendar'
                ? t.calendarShort
                : key === 'organization'
                  ? t.organize
                  : key === 'community'
                    ? t.liveTogether
                    : t[key]}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
