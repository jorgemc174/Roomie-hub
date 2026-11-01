'use client';
import Link from 'next/link';
import { AccountLink } from '@/components/account-navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { Feedback } from '@/components/ui/feedback';
import { Bell, LoaderCircle } from 'lucide-react';
import { useCallback, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { useLocale } from '@/lib/i18n/provider';
import { safeNext } from '@/lib/validation';
import { readNotices } from './actions';
import { notificationMessages } from './messages';
import type { Notice } from './models';
import { useNoticesRealtime } from './realtime';
export function NotificationBell() {
  const t = notificationMessages(useLocale()),
    [count, setCount] = useState(0);
  const refresh = useCallback(async () => {
    const { count, error } = await browserClient()
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .is('read_at', null);
    if (!error) setCount(count ?? 0);
  }, []);
  useNoticesRealtime(refresh);
  return (
    <AccountLink
      className="topbar-action notification-bell"
      href="/notifications"
      aria-label={`${t.title}${count ? ` (${count})` : ''}`}
    >
      <Bell size={20} aria-hidden="true" />
      <span>{t.title}</span>
      {count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
    </AccountLink>
  );
}
export function Inbox({ initial }: { initial: Notice[] }) {
  const locale = useLocale(),
    t = notificationMessages(locale),
    [rows, setRows] = useState(initial),
    [cursor, setCursor] = useState<Notice | null>(null),
    [error, setError] = useState(''),
    [pending, setPending] = useState(false);
  const load = useCallback(
    async (before: Notice | null) => {
      setPending(true);
      setError('');
      try {
        let q = browserClient()
          .from('notifications')
          .select('*')
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .limit(50);
        if (before)
          q = q.or(
            `created_at.lt.${before.created_at},and(created_at.eq.${before.created_at},id.lt.${before.id})`,
          );
        const { data, error } = await q;
        if (error) throw error;
        setRows(data);
        setCursor(before);
      } catch {
        setError(t.error);
      } finally {
        setPending(false);
      }
    },
    [t.error],
  );
  const refresh = useCallback(() => load(cursor), [load, cursor]);
  useNoticesRealtime(refresh);
  async function mark(id?: string) {
    setPending(true);
    setError('');
    try {
      if (!navigator.onLine || !(await readNotices(id))) throw new Error();
      await load(cursor);
    } catch {
      setError(t.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="stack" aria-busy={pending}>
      <div className="notification-toolbar">
        <AccountLink className="button secondary" href="/notifications/preferences">
          {t.preferences}
        </AccountLink>
        <button
          className="button secondary"
          disabled={pending || !rows.some((n) => !n.read_at)}
          onClick={() => void mark()}
        >
          {t.all}
        </button>
        <button className="button secondary" disabled={pending} onClick={() => void load(null)}>
          {t.recent}
        </button>
      </div>
      {pending && (
        <p className="ui-inline-loading" role="status">
          <LoaderCircle size={18} className="ui-spinner" aria-hidden="true" />
          {t.loading}
        </p>
      )}
      {error && <Feedback kind="error">{error}</Feedback>}
      {!rows.length && !pending && <EmptyState title={t.empty} icon={<Bell size={24} />} />}
      {rows.map((n) => (
        <article key={n.id} className={`panel notification-card ${!n.read_at ? 'unread' : ''}`}>
          <h2>
            <Link href={safeNext(n.target_url)}>{n.title}</Link>
            {!n.read_at && (
              <span className="unread-dot" aria-label={t.unread}>
                {' '}
                ●
              </span>
            )}
          </h2>
          <p>{n.body}</p>
          <time dateTime={n.created_at}>
            {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(n.created_at),
            )}
          </time>
          {!n.read_at && (
            <button className="button secondary" disabled={pending} onClick={() => void mark(n.id)}>
              {t.read}
            </button>
          )}
        </article>
      ))}
      <button
        className="button secondary"
        disabled={pending || rows.length < 50}
        onClick={() => void load(rows.at(-1) ?? null)}
      >
        {t.older}
      </button>
    </div>
  );
}
