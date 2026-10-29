import Link from 'next/link';
import { House } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Brand } from './brand';
import { Preferences } from './preferences';
import { PasswordField } from './password-field';
import { ActionForm } from './action-form';
import { authAction, googleAction } from '@/app/actions';
import { i18n } from '@/lib/i18n/server';
import { configured } from '@/lib/supabase/config';
import { safeNext } from '@/lib/validation';
export async function AuthScreen({
  kind,
  next = '',
  error = '',
}: {
  kind: 'login' | 'register' | 'recover' | 'reset';
  next?: string;
  error?: string;
}) {
  if (!configured()) redirect('/setup');
  next = safeNext(next);
  const prefs = await i18n();
  const { t } = prefs;
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true';
  const title =
    kind === 'login'
      ? t.authTitle
      : kind === 'register'
        ? t.registerTitle
        : kind === 'recover'
          ? t.recover
          : t.reset;
  const label =
    kind === 'login'
      ? t.login
      : kind === 'register'
        ? t.register
        : kind === 'recover'
          ? t.sendLink
          : t.reset;
  return (
    <div className="auth-shell">
      <aside className="auth-story">
        <Brand />
        <div className="auth-story-content">
          <div className="home-symbol">
            <House size={45} strokeWidth={1.3} aria-hidden="true" />
          </div>
          <p className="eyebrow" style={{ marginTop: 30 }}>
            {t.tagline}
          </p>
          <p className="auth-marketing-title">{t.welcome}</p>
          <p>{t.welcomeBody}</p>
        </div>
        <small>{t.footer}</small>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">{label}</p>
          <h1>{title}</h1>
          {kind === 'recover' && <p>{t.recoverBody}</p>}
          {error && (error !== 'google' || !googleEnabled) && (
            <p className="notice error" role="alert">
              {error === 'google' ? t.googleError : error === 'link' ? t.sessionError : t.authError}
            </p>
          )}
          <ActionForm action={authAction.bind(null, kind)} label={label} pendingLabel={t.saving}>
            <input type="hidden" name="next" value={next} />
            {kind === 'register' && (
              <label>
                {t.name}
                <input name="name" autoComplete="name" minLength={2} maxLength={80} required />
              </label>
            )}
            {kind !== 'reset' && (
              <label>
                {t.email}
                <input
                  name="email"
                  type="email"
                  autoComplete="email"
                  spellCheck={false}
                  autoCapitalize="none"
                  required
                  maxLength={254}
                />
              </label>
            )}
            {kind !== 'recover' && (
              <PasswordField
                label={kind === 'reset' ? t.newPassword : t.password}
                showLabel={t.showPassword}
                hideLabel={t.hidePassword}
                autoComplete={kind === 'login' ? 'current-password' : 'new-password'}
                minLength={kind === 'login' ? 1 : 4}
                hint={kind !== 'login' ? t.passwordHint : undefined}
              />
            )}
            {kind === 'login' && (
              <Link className="text-link" href="/forgot-password">
                {t.forgot}
              </Link>
            )}
          </ActionForm>
          {(kind === 'login' || kind === 'register') && googleEnabled && (
            <div style={{ marginTop: 16 }}>
              <ActionForm
                action={googleAction}
                label={t.google}
                pendingLabel={t.saving}
                initialError={error === 'google' ? t.googleError : undefined}
                secondary
              >
                <input type="hidden" name="next" value={next} />
              </ActionForm>
            </div>
          )}
          <p className="auth-bottom">
            {kind === 'login' ? t.noAccount : kind === 'register' ? t.hasAccount : ''}
            <Link
              className="text-link"
              href={
                kind === 'login'
                  ? `/register${next ? `?next=${encodeURIComponent(next)}` : ''}`
                  : `/login${next ? `?next=${encodeURIComponent(next)}` : ''}`
              }
            >
              {kind === 'login' ? t.register : t.login}
            </Link>
          </p>
        </div>
        <Preferences {...prefs} />
      </main>
    </div>
  );
}
