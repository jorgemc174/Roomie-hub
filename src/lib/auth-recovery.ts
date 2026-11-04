import { authFailurePath } from './auth-redirects';

/** Only a recovery fragment may install a session on this callback. */
export function recoveryTokens(fragment: string) {
  const params = new URLSearchParams(fragment.replace(/^#/, ''));
  if (params.has('error') || params.has('error_code') || params.has('error_description'))
    return null;
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  if (params.get('type') !== 'recovery' || !access_token?.trim() || !refresh_token?.trim())
    return null;
  return { access_token, refresh_token };
}

export function recoveryDestination(established: boolean, next: string | null) {
  return established ? '/reset-password' : authFailurePath(next);
}
