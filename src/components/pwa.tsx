'use client';
import { useEffect, useState } from 'react';
import { useLocale } from '@/lib/i18n/provider';
const messages = {
  es: {
    update: 'Hay una actualización disponible.',
    apply: 'Actualizar y recargar',
    hint: 'Guarda los cambios del formulario antes de actualizar.',
    offline: 'Sin conexión. No se han guardado cambios.',
  },
  en: {
    update: 'An update is available.',
    apply: 'Update and reload',
    hint: 'Save form changes before updating.',
    offline: 'Offline. Changes have not been saved.',
  },
};
export function Pwa() {
  const t = messages[useLocale()],
    [waiting, setWaiting] = useState<ServiceWorker | null>(null),
    [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const block = (event: Event) => {
      if (!navigator.onLine) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setBlocked(true);
      }
    };
    const online = () => setBlocked(false);
    document.addEventListener('submit', block, true);
    window.addEventListener('online', online);
    let disposed = false;
    let registration: ServiceWorkerRegistration | undefined;
    const update = () => {
      if (registration?.waiting && !disposed) setWaiting(registration.waiting);
    };
    const found = () => {
      registration?.installing?.addEventListener('statechange', update);
    };
    if ('serviceWorker' in navigator)
      void navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .then((r) => {
          registration = r;
          if (disposed) return;
          r.addEventListener('updatefound', found);
          update();
        })
        .catch(() => {});
    return () => {
      disposed = true;
      registration?.removeEventListener('updatefound', found);
      document.removeEventListener('submit', block, true);
      window.removeEventListener('online', online);
    };
  }, []);
  const apply = () => {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
      once: true,
    });
    waiting?.postMessage({ type: 'APPLY_UPDATE' });
  };
  return (
    <>
      {blocked && (
        <p className="notice error" role="alert">
          {t.offline}
        </p>
      )}
      {waiting && (
        <aside className="notice" role="status">
          <p>
            {t.update} {t.hint}
          </p>
          <button onClick={apply}>{t.apply}</button>
        </aside>
      )}
    </>
  );
}
