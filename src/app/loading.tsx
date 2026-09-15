import { i18n } from '@/lib/i18n/server';
export default async function Loading() {
  const { t } = await i18n();
  return (
    <main id="main" className="page" role="status">
      <p>{t.loading}</p>
    </main>
  );
}
