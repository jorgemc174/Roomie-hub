import { PageHeader } from '@/components/ui/page-header';
import Link from 'next/link';
import { i18n } from '@/lib/i18n/server';
import { homeAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { CurrencySelect } from '@/components/currency-select';
import { COMMON_TIMEZONES, DEFAULT_HOME_TIMEZONE } from '@/lib/timezones';
export default async function NewHome({
  searchParams,
}: {
  searchParams: Promise<{ created?: string }>;
}) {
  const { t, locale } = await i18n();
  const { created } = await searchParams;
  if (created && /^[a-f0-9-]{36}$/i.test(created))
    return (
      <div className="narrow">
        <PageHeader title={t.createHome} description={t.homeCreatedIncomplete} />
        <Link className="button" href={`/homes/${created}/settings`}>
          {t.settings}
        </Link>
        <Link className="back-link" href="/homes">
          {t.homes}
        </Link>
      </div>
    );
  return (
    <div className="narrow">
      <Link href="/homes" className="back-link">
        ← {t.homes}
      </Link>
      <PageHeader title={t.createHome} description={t.createBody} />
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
            {t.homeImage}
            <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>{t.imageHint}</small>
          </label>
          <label>
            {t.currency}
            <CurrencySelect locale={locale} />
          </label>
          <label>
            {t.homeTimezone}
            <select name="timezone" defaultValue={DEFAULT_HOME_TIMEZONE} required>
              {COMMON_TIMEZONES.map((zone) => (
                <option key={zone} value={zone}>
                  {zone}
                </option>
              ))}
            </select>
          </label>
        </ActionForm>
      </section>
    </div>
  );
}
