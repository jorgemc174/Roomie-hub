'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { browserClient } from '@/lib/supabase/browser';
import { useLocale } from '@/lib/i18n/provider';
import { organizationMessages } from '@/features/organization/messages';
export function HomeSync({ homeId }: { homeId: string }) {
  const router = useRouter();
  const [connected, setConnected] = useState(true);
  const t = organizationMessages(useLocale());
  useEffect(() => {
    const db = browserClient();
    let disposed = false;
    let channel: ReturnType<typeof db.channel> | undefined;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      if (!disposed) timer = setTimeout(() => router.refresh(), 250);
    };
    const connect = async () => {
      // SSR cookies must be read before the first websocket subscription; otherwise
      // the channel can join with the public key and silently miss RLS-protected changes.
      const {
        data: { session },
      } = await db.auth.getSession();
      if (disposed) return;
      if (!session) {
        setConnected(false);
        return;
      }
      await db.realtime.setAuth(session.access_token);
      if (disposed) return;
      channel = db
        // A fresh topic prevents Strict Mode's async cleanup from removing the next mount's channel.
        .channel(`home:${homeId}:${crypto.randomUUID()}`, {
          config: { postgres_changes_options: { wait: true, timeout: 15000 } },
        })
        .on('system', {}, (payload) => {
          // Channel join can precede the PostgreSQL listener. Refetch when it is ready,
          // closing the read/subscribe gap, and expose replication errors as degraded.
          if (disposed) return;
          setConnected(payload.status === 'ok');
          if (payload.status === 'ok') refresh();
        })
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'homes', filter: `id=eq.${homeId}` },
          refresh,
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'home_members', filter: `home_id=eq.${homeId}` },
          refresh,
        );
      for (const table of [
        'chores',
        'chore_instances',
        'absences',
        'shopping_lists',
        'shopping_items',
        'expenses',
        'settlements',
        'recurring_expenses',
        'recurring_expense_instances',
        'resources',
        'reservations',
        'activities',
        'activity_members',
      ]) {
        channel
          .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table, filter: `home_id=eq.${homeId}` },
            refresh,
          )
          .on(
            'postgres_changes',
            { event: 'UPDATE', schema: 'public', table, filter: `home_id=eq.${homeId}` },
            refresh,
          );
      }
      channel.subscribe((status) => {
        if (disposed) return;
        setConnected(status === 'SUBSCRIBED');
        if (status === 'SUBSCRIBED') refresh();
      });
    };
    void connect().catch(() => {
      if (!disposed) setConnected(false);
    });
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      if (channel) void db.removeChannel(channel);
    };
  }, [homeId, router]);
  return connected ? null : (
    <p className="notice" role="status">
      {t.reconnecting}
    </p>
  );
}
