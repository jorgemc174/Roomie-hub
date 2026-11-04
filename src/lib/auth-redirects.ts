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
export type EmailOtpType = 'email' | 'signup' | 'recovery';
/**
 * Email links arrive either with token_hash/type (configured templates, any device) or,
 * with Supabase's default templates, already verified and carrying a PKCE code.
 */
export function emailConfirmation(
  params: URLSearchParams,
):
  | { kind: 'otp'; tokenHash: string; type: EmailOtpType }
  | { kind: 'code'; code: string }
  | { kind: 'invalid' } {
  const tokenHash = params.get('token_hash');
  const type = params.get('type');
  if (tokenHash && (type === 'email' || type === 'signup' || type === 'recovery'))
    return { kind: 'otp', tokenHash, type };
  const code = params.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'invalid' };
}
export function authFailurePath(next: string | null, error: 'link' | 'auth' | 'google' = 'link') {
  const query = new URLSearchParams({ error, next: safeNext(next) });
  return `/login?${query}`;
}

export function googleCallbackFailurePath(next: string | null, error: string | null) {
  if (error === 'access_denied') {
    return `/login?${new URLSearchParams({ notice: 'googleCancelled', next: safeNext(next) })}`;
  }
  // A missing code/verifier is also a failed OAuth flow, not an expired email link.
  return authFailurePath(next, 'google');
}
