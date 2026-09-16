import { getHome, requireUser } from '@/lib/data';
import { notFound, redirect } from 'next/navigation';
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ homeId: string; receiptId: string }> },
) {
  const { homeId, receiptId } = await params;
  await getHome(homeId);
  const { db } = await requireUser();
  const { data, error } = await db
    .from('expense_attachments')
    .select('path')
    .eq('home_id', homeId)
    .eq('id', receiptId)
    .maybeSingle();
  if (error || !data) notFound();
  const signed = await db.storage
    .from('expense-receipts')
    .createSignedUrl(data.path, 60, { download: true });
  if (signed.error || !signed.data) notFound();
  redirect(signed.data.signedUrl);
}
