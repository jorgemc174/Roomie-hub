'use client';

import { useEffect, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { config } from '@/lib/supabase/config';
import type { Database } from '@/lib/supabase/database.types';
import { recoveryDestination, recoveryTokens } from '@/lib/auth-recovery';

export function RecoverySession({ loading }: { loading: string }) {
  const started = useRef(false);
  useEffect(() => {
    // Strict Mode may run this effect twice; never re-read the cleared fragment.
    if (started.current) return;
    started.current = true;
    const tokens = recoveryTokens(window.location.hash);
    const next = new URLSearchParams(window.location.search).get('next');
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    async function establishSession() {
      let established = false;
      try {
        if (tokens) {
          const { url, key } = config();
          // SSR's browser client persists to cookies. Disable automatic URL handling so
          // setSession is the only consumer, and never reuse a differently configured singleton.
          const db = createBrowserClient<Database>(url, key, {
            isSingleton: false,
            auth: { detectSessionInUrl: false },
          });
          const { data, error } = await db.auth.setSession(tokens);
          established = !error && Boolean(data.session);
        }
      } catch {
        // Never surface provider details or tokens in the error destination.
      }
      // Full navigation makes the server read the newly written session cookies.
      window.location.replace(recoveryDestination(established, next));
    }
    void establishSession();
  }, []);
  return <p role="status">{loading}</p>;
}
