import Link from 'next/link';
import { i18n } from '@/lib/i18n/server';
import { homeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { CurrencySelect } from '@/components/currency-select';
export default async function NewHome() {
  const { t, locale } = await i18n();
  return (
    <div className="narrow">
      <Link href="/homes" className="back-link">
        ← {t.homes}
      </Link>
      <header className="page-head">
        <div>
          <h1>{t.createHome}</h1>
          <p>{t.createBody}</p>
        </div>
      </header>
      <section className="panel">
        <ActionForm
          action={homeAction.bind(null, 'create')}
          label={t.create}
          pendingLabel={t.saving}
        >
          <label>
            {t.homeName}
            <input name="name" required minLength={2} maxLength={80} autoComplete="off" />
          </label>
          <label>
            {t.currency}
            <CurrencySelect locale={locale} />
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
