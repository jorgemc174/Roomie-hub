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
  const href = accountReturnHref(useCurrentHref());
  if (!href) return null;
  return (
    <Link href={href} className="text-link account-return">
      <ArrowLeft size={18} aria-hidden="true" />
      {label}
    </Link>
  );
}
