'use client';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useSyncExternalStore, type ComponentProps } from 'react';
import { ArrowLeft } from 'lucide-react';
import { accountHref, accountReturnHref, type AccountDestination } from '@/lib/account-navigation';

function subscribeHash(listener: () => void) {
  window.addEventListener('hashchange', listener);
  window.addEventListener('popstate', listener);
  return () => {
    window.removeEventListener('hashchange', listener);
    window.removeEventListener('popstate', listener);
  };
}
const readHash = () => window.location.hash;
const serverHash = () => '';
function useCurrentHref() {
  const path = usePathname(),
    search = useSearchParams().toString();
  const hash = useSyncExternalStore(subscribeHash, readHash, serverHash);
  return `${path}${search ? `?${search}` : ''}${hash}`;
}

export function AccountLink({
  href,
  children,
  ...props
}: Omit<ComponentProps<typeof Link>, 'href'> & { href: AccountDestination }) {
  const current = useCurrentHref();
  return (
    <Link {...props} href={accountHref(href, current)}>
      {children}
    </Link>
  );
}

export function AccountReturn({ label }: { label: string }) {
  const current = useCurrentHref();
  const path = usePathname();
  const search = useSearchParams();
  const href =
    path === '/notifications/preferences' && !search.has('returnTo') && !search.has('from')
      ? '/homes'
      : accountReturnHref(current);
  if (!href && !['/profile', '/notifications'].includes(path)) return null;
  return (
    <Link
      href={href ?? '/homes'}
      className="back-link account-return"
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        // The Navigation API exposes the actual preceding entry, including SPA navigation.
        // Never use history.length alone: that entry could belong to another site.
        const navigation = (
          window as Window & {
            navigation?: {
              currentEntry?: { index: number };
              entries: () => { url?: string }[];
            };
          }
        ).navigation;
        const index = navigation?.currentEntry?.index ?? 0;
        const previous = navigation?.entries()[index - 1]?.url;
        if (previous && new URL(previous).origin === window.location.origin) {
          event.preventDefault();
          window.history.back();
        }
      }}
    >
      <ArrowLeft size={18} aria-hidden="true" />
      {label}
    </Link>
  );
}
