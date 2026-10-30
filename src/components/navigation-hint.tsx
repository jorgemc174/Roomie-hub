'use client';
import { useLinkStatus } from 'next/link';
export function NavigationHint() {
  const { pending } = useLinkStatus();
  return <span aria-hidden="true" className={`link-progress${pending ? ' is-pending' : ''}`} />;
}
