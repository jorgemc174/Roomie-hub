import Link from 'next/link';
import { i18n } from '@/lib/i18n/server';
import { homeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
export default async function Join({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { t } = await i18n();
  const { code } = await searchParams;
  return (
    <div className="narrow">
      <Link href="/homes" className="back-link">
        ← {t.homes}
      </Link>
      <header className="page-head">
        <div>
          <h1>{t.joinHome}</h1>
          <p>{t.joinBody}</p>
        </div>
      </header>
      <section className="panel">
        <ActionForm action={homeAction.bind(null, 'join')} label={t.join} pendingLabel={t.saving}>
          <label>
            {t.code}
            <input
              name="code"
              defaultValue={code ?? ''}
              required
              minLength={32}
              maxLength={32}
              autoCapitalize="none"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
