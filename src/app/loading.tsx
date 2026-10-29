import { i18n } from '@/lib/i18n/server';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
export default async function Loading() {
  const { t } = await i18n();
  return (
    <main id="main" className="page">
      <LoadingSkeleton label={t.loading} />
    </main>
  );
}
