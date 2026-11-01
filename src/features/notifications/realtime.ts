'use client';
import { useEffect } from 'react';
import { browserClient } from '@/lib/supabase/browser';

// Both the bell and the visible inbox refresh through RLS, including on reconnect.
export function useNoticesRealtime(refresh: () => Promise<void>) {
  useEffect(() => {
    const db = browserClient();
    let disposed = false;
    let channel: ReturnType<typeof db.channel> | undefined;
    const update = () => {
      if (!disposed) void refresh().catch(() => {});
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
          update,
        )
        .subscribe((status) => {
          if (status === 'SUBSCRIBED') update();
        });
      update();
    };
    void connect().catch(() => {});
    window.addEventListener('focus', update);
    return () => {
      disposed = true;
      window.removeEventListener('focus', update);
      if (channel) void db.removeChannel(channel);
    };
  }, [refresh]);
}
