'use client';
import { useMessages } from '@/lib/i18n/provider';
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useMessages();
  return (
    <main id="main" className="setup">
      <div className="panel">
        <h1>{t.errorTitle}</h1>
        <p>{t.connectionError}</p>
        <button className="button" onClick={reset}>
          {t.retry}
        </button>
      </div>
    </main>
  );
}
