import Link from 'next/link';
import { House } from 'lucide-react';
import { redirect } from 'next/navigation';
import { Brand } from './brand';
import { Preferences } from './preferences';
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
          <h1>{t.welcome}</h1>
          <p>{t.welcomeBody}</p>
        </div>
        <small>{t.footer}</small>
      </aside>
      <main id="main" className="auth-main">
        <div className="auth-card">
          <p className="eyebrow">{label}</p>
          <h2>{title}</h2>
          {kind === 'recover' && <p>{t.recoverBody}</p>}
          {error && (
            <p className="notice error" role="alert">
              {error === 'link' ? t.sessionError : t.authError}
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
                <input name="email" type="email" autoComplete="email" required maxLength={254} />
              </label>
            )}
            {kind !== 'recover' && (
              <label>
                {kind === 'reset' ? t.newPassword : t.password}
                <input
                  name="password"
                  type="password"
                  autoComplete={kind === 'login' ? 'current-password' : 'new-password'}
                  minLength={kind === 'login' ? 1 : 4}
                  maxLength={128}
                  required
                />
                {kind !== 'login' && <small>{t.passwordHint}</small>}
              </label>
            )}
            {kind === 'login' && (
              <Link className="text-link" href="/forgot-password">
                {t.forgot}
              </Link>
            )}
          </ActionForm>
          {(kind === 'login' || kind === 'register') &&
            process.env.NEXT_PUBLIC_GOOGLE_AUTH_ENABLED === 'true' && (
              <form action={googleAction} style={{ marginTop: 16 }}>
                <input type="hidden" name="next" value={next} />
                <button className="button secondary" style={{ width: '100%' }}>
                  {t.google}
                </button>
              </form>
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
