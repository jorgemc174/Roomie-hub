import { CommunityPage } from '@/features/community/page';
import { OrganizationPage } from '@/features/organization/page';

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ homeId }, search] = await Promise.all([params, searchParams]);
  if (search.tab === 'tasks' || search.tab === 'absences')
    return <OrganizationPage homeId={homeId} search={search} />;
  return <CommunityPage homeId={homeId} search={search} />;
}
