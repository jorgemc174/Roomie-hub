'use client';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { useLocale } from '@/lib/i18n/provider';
import { safeNext } from '@/lib/validation';
import { readNotices } from './actions';
import { notificationMessages } from './messages';
import type { Notice } from './models';
export function NotificationBell() {
  const t = notificationMessages(useLocale()),
    [count, setCount] = useState(0);
  useEffect(() => {
    const db = browserClient();
    let disposed = false;
    let channel: ReturnType<typeof db.channel> | undefined;
    const refresh = async () => {
      const { count, error } = await db
        .from('notifications')
        .select('id', { count: 'exact', head: true })
        .is('read_at', null);
      if (!disposed && !error) setCount(count ?? 0);
    };
    const connect = async () => {
      const {
        data: { session },
      } = await db.auth.getSession();
      if (!session || disposed) return;
      await db.realtime.setAuth(session.access_token);
      if (disposed) return;
      channel = db
        .channel(`notices:${session.user.id}:${crypto.randomUUID()}`, {
          config: { postgres_changes_options: { wait: true, timeout: 15000 } },
        })
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${session.user.id}`,
          },
          () => void refresh(),
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') void refresh();
        });
      await refresh();
    };
    void connect().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      window.removeEventListener('focus', refresh);
      if (channel) void db.removeChannel(channel);
    };
  }, []);
  return (
    <Link href="/notifications" aria-label={`${t.title}${count ? ` (${count})` : ''}`}>
      {t.title}
      {count > 0 && <span className="badge">{count > 99 ? '99+' : count}</span>}
    </Link>
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
  async function mark(id?: string) {
    setPending(true);
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
    <div className="stack">
      <div className="row wrap">
        <Link href="/notifications/preferences">{t.preferences}</Link>
        <button disabled={pending} onClick={() => void mark()}>
          {t.all}
        </button>
        <button disabled={pending} onClick={() => void load(null)}>
          {t.recent}
        </button>
      </div>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {!rows.length && <p>{t.empty}</p>}
      {rows.map((n) => (
        <article key={n.id} className="panel">
          <h2>
            <Link href={safeNext(n.target_url)}>{n.title}</Link>
            {!n.read_at && <span aria-label={t.read}> ●</span>}
          </h2>
          <p>{n.body}</p>
          <time dateTime={n.created_at}>
            {new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
              new Date(n.created_at),
            )}
          </time>
          {!n.read_at && (
            <button disabled={pending} onClick={() => void mark(n.id)}>
              {t.read}
            </button>
          )}
        </article>
      ))}
      <button disabled={pending || rows.length < 50} onClick={() => void load(rows.at(-1) ?? null)}>
        {t.older}
      </button>
    </div>
  );
}
