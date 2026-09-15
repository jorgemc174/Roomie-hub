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
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 250);
    };
    const channel = db
      .channel(`home:${homeId}`)
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
      setConnected(status === 'SUBSCRIBED');
      if (status === 'SUBSCRIBED') refresh();
    });
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      void db.removeChannel(channel);
    };
  }, [homeId, router]);
  return connected ? null : (
    <p className="notice" role="status">
      {t.reconnecting}
    </p>
  );
}
