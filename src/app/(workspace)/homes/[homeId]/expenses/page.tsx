import { ExpensesPage } from '@/features/expenses/page';
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <ExpensesPage homeId={(await params).homeId} search={await searchParams} />;
}
