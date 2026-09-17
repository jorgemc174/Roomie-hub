'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale } from '@/lib/i18n/provider';
import { registerPush, revokePush } from './actions';
import { notificationMessages } from './messages';
export function PushDevices({
  devices,
  publicKey,
}: {
  devices: { id: string; label: string; endpoint: string }[];
  publicKey: string;
}) {
  const t = notificationMessages(useLocale()),
    router = useRouter(),
    [status, setStatus] = useState(''),
    [pending, setPending] = useState(false);
  async function enable() {
    setPending(true);
    setStatus('');
    try {
      if (!navigator.onLine) throw new Error(t.error);
      if (
        !('serviceWorker' in navigator) ||
        !('PushManager' in window) ||
        !('Notification' in window)
      )
        throw new Error(t.unsupported);
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error(t.denied);
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription)
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(
            atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')),
            (c) => c.charCodeAt(0),
          ),
        });
      const json = subscription.toJSON();
      if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) throw new Error(t.error);
      if (
        !(await registerPush({
          endpoint: json.endpoint,
          keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        }))
      ) {
        await subscription.unsubscribe();
        throw new Error(t.error);
      }
      setStatus(t.enabled);
      router.refresh();
    } catch (e) {
      setStatus(
        e instanceof Error && [t.denied, t.unsupported].includes(e.message) ? e.message : t.error,
      );
    } finally {
      setPending(false);
    }
  }
  async function disable(id: string, endpoint: string) {
    setPending(true);
    try {
      if (!(await revokePush(id))) throw new Error();
      if ('serviceWorker' in navigator) {
        const reg = await navigator.serviceWorker.getRegistration('/');
        const sub = await reg?.pushManager.getSubscription();
        if (sub?.endpoint === endpoint) await sub.unsubscribe();
      }
      router.refresh();
    } catch {
      setStatus(t.error);
    } finally {
      setPending(false);
    }
  }
  return (
    <section className="panel stack">
      <h2>{t.devices}</h2>
      <p>{t.permission}</p>
      {!publicKey && <p className="notice">{t.unavailable}</p>}
      <button disabled={pending || !publicKey} onClick={() => void enable()}>
        {t.enable}
      </button>
      {status && <p role="status">{status}</p>}
      {devices.map((d) => (
        <div key={d.id} className="row wrap">
          <span>
            {d.label || 'Browser'} · {d.id.slice(0, 8)}
          </span>
          <button disabled={pending} onClick={() => void disable(d.id, d.endpoint)}>
            {t.disable}
          </button>
        </div>
      ))}
    </section>
  );
}
