import type { Messages } from './i18n/dictionaries';
type AuthFailure = { code?: string; status?: number; name?: string };
/** Never expose provider messages, emails, tokens or passwords to the UI or logs. */
export function authErrorMessage(error: AuthFailure, t: Messages) {
  if (error.code === 'weak_password') return t.passwordRejected;
  if (
    error.status === 429 ||
    ['over_email_send_rate_limit', 'over_request_rate_limit', 'over_send_rate_limit'].includes(
      error.code ?? '',
    )
  )
    return t.authRateLimit;
  if (error.code === 'email_address_invalid') return t.authEmailInvalid;
  if (error.code === 'email_address_not_authorized') return t.authEmailUnauthorized;
  if (error.code === 'email_address_not_allowed') return t.authEmailRejected;
  if (['signup_disabled', 'email_provider_disabled'].includes(error.code ?? ''))
    return t.authSignupDisabled;
  if (error.code === 'email_not_confirmed') return t.authEmailUnconfirmed;
  if (['invalid_credentials', 'user_already_exists', 'email_exists'].includes(error.code ?? ''))
    return t.authError;
  if (error.name === 'AuthRetryableFetchError' || error.status === 0) return t.requestError;
  return t.authServiceError;
}
