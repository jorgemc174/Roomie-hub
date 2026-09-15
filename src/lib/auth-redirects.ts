import { safeNext } from './validation';
/** Canonical app origin, never an incoming Host/X-Forwarded-Host header. */
export function siteOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL;
  if (!value) throw new Error('site_url_missing');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('invalid_site_url');
  return url.origin;
}
/** Every provider carries its own destination; no mutable shared cookie or localStorage. */
export function authReturnUrl(
  origin: string,
  path: '/auth/confirm' | '/auth/callback',
  next: string,
) {
  const url = new URL(path, new URL(origin).origin);
  url.searchParams.set('next', safeNext(next));
  return url.toString();
}
export function authDestination(next: string | null, type?: string | null) {
  return type === 'recovery' ? '/reset-password' : safeNext(next);
}
export function authFailurePath(next: string | null, error: 'link' | 'auth' = 'link') {
  const query = new URLSearchParams({ error, next: safeNext(next) });
  return `/login?${query}`;
}
