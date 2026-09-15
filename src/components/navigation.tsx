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
      {[{ key: 'home', icon: House }, ...modules].map(({ key, icon: Icon }) => {
        const href = `/homes/${homeId}${key === 'home' ? '' : `/${key}`}`;
        return (
          <Link
            key={key}
            href={href}
            className={pathname === href ? 'active' : ''}
            aria-current={pathname === href ? 'page' : undefined}
          >
            <Icon size={21} aria-hidden="true" />
            {
              t[
                key as keyof Pick<
                  Messages,
                  'home' | 'calendar' | 'organization' | 'expenses' | 'community' | 'chat'
                >
              ]
            }
          </Link>
        );
      })}
    </nav>
  );
}
