import { redirect } from 'next/navigation';
import { getHome } from '@/lib/data';
import { legacyReservationsHref } from '@/features/calendar/legacy';
// Reservations are managed in the calendar; the former route keeps its links working.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ homeId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { homeId } = await params;
  await getHome(homeId);
  redirect(legacyReservationsHref(homeId, await searchParams));
}
