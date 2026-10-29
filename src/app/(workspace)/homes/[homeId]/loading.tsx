import { i18n } from '@/lib/i18n/server';
import { LoadingSkeleton } from '@/components/ui/loading-skeleton';
export default async function Loading() {
  const { t } = await i18n();
  return <LoadingSkeleton label={t.loading} />;
}
