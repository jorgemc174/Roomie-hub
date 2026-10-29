import { SearchX } from 'lucide-react';
import Link from 'next/link';
import { i18n } from '@/lib/i18n/server';
export default async function NotFound() {
  const { t } = await i18n();
  return (
    <main id="main" className="setup">
      <div className="panel ui-error-state">
        <span className="ui-state-icon" aria-hidden="true">
          <SearchX size={28} />
        </span>
        <h1>{t.notFound}</h1>
        <p>{t.notFoundBody}</p>
        <Link href="/homes" className="button">
          {t.homes}
        </Link>
      </div>
    </main>
  );
}
