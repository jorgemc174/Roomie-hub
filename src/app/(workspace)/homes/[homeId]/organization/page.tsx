import { OrganizationPage } from '@/features/organization/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <OrganizationPage homeId={(await params).homeId} search={await searchParams} />;
}
