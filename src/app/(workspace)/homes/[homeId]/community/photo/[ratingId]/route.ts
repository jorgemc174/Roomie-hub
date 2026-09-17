import { getHome, requireUser } from '@/lib/data';
import { notFound } from 'next/navigation';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ homeId: string; ratingId: string }> },
) {
  const { homeId, ratingId } = await params;
  await getHome(homeId);
  const { db } = await requireUser();
  const { data, error } = await db
    .from('ratings')
    .select('attachment_path')
    .eq('home_id', homeId)
    .eq('id', ratingId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error || !data?.attachment_path) notFound();
  const photo = await db.storage
    .from('rating-photos')
    .download(data.attachment_path, { cacheNonce: crypto.randomUUID() }, { cache: 'no-store' });
  if (photo.error || !photo.data) notFound();
  return new Response(await photo.data.arrayBuffer(), {
    headers: {
      'Content-Type': 'image/webp',
      'Content-Disposition': 'inline; filename="photo.webp"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
