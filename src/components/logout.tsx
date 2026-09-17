'use client';
import { useState } from 'react';
import { logoutAction } from '@/app/actions';
import { browserClient } from '@/lib/supabase/browser';
export function Logout({
  label,
  pendingLabel,
  errorLabel,
}: {
  label: string;
  pendingLabel: string;
  errorLabel: string;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  async function logout() {
    setPending(true);
    setError('');
    try {
      if (!navigator.onLine) throw new Error();
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/');
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) {
          const db = browserClient();
          const { data, error } = await db
            .from('push_subscriptions')
            .select('id')
            .eq('endpoint', subscription.endpoint)
            .maybeSingle();
          if (error) throw error;
          if (data) {
            const revoked = await db.rpc('revoke_push_subscription', { item: data.id });
            if (revoked.error) throw revoked.error;
          }
          await subscription.unsubscribe();
        }
        navigator.serviceWorker.controller?.postMessage({ type: 'LOGOUT' });
      }
      if ('caches' in window) for (const key of await caches.keys()) await caches.delete(key);
      const result = await logoutAction({});
      if (result.error) setError(result.error);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith('NEXT_REDIRECT')) throw e;
      setError(errorLabel);
    } finally {
      setPending(false);
    }
  }
  return (
    <div>
      <button disabled={pending} onClick={() => void logout()}>
        {pending ? pendingLabel : label}
      </button>
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
    </div>
  );
}
