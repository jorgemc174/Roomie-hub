import { safeNext } from './validation';

export type AccountDestination = '/profile' | '/notifications' | '/notifications/preferences';
const origin = 'https://roomiehub.invalid';

function workspaceHref(value: string | null): string | null {
  if (!value || safeNext(value) !== value) return null;
  const url = new URL(value, origin);
  // Only return to workspace screens, never downloads or an arbitrary supplied URL.
  return /^\/homes\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\/(?:calendar|organization(?:\/reservations)?|expenses|community(?:\/activities)?|chat|settings))?$/i.test(
    url.pathname,
  )
    ? value
    : null;
}

function context(current: string) {
  const url = new URL(safeNext(current), origin);
  const returns = url.searchParams.getAll('returnTo');
  return {
    url,
    returnTo: workspaceHref(current) ?? (returns.length === 1 ? workspaceHref(returns[0]) : null),
  };
}

export function accountHref(destination: AccountDestination, current: string): string {
  const { url, returnTo } = context(current);
  const params = new URLSearchParams();
  if (returnTo) params.set('returnTo', returnTo);
  if (destination === '/notifications/preferences' && url.pathname === '/profile')
    params.set('from', 'profile');
  const search = params.toString();
  return `${destination}${search ? `?${search}` : ''}`;
}

export function accountReturnHref(current: string): string | null {
  const { url, returnTo } = context(current);
  if (url.pathname === '/notifications/preferences')
    return accountHref(
      url.searchParams.get('from') === 'profile' ? '/profile' : '/notifications',
      current,
    );
  return returnTo;
}
