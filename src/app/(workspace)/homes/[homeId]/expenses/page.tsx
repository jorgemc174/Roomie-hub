import { ExpensesPage } from '@/features/expenses/page';
import { OrganizationPage } from '@/features/organization/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ homeId }, search] = await Promise.all([params, searchParams]);
  if (search.tab === 'shopping') return <OrganizationPage homeId={homeId} search={search} />;
  return <ExpensesPage homeId={homeId} search={search} />;
}
