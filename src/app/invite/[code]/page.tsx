import { redirect } from 'next/navigation';
import { configured } from '@/lib/supabase/config';
import { supabase } from '@/lib/supabase/server';
export default async function Invite({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const next = `/homes/join?code=${encodeURIComponent(code)}`;
  if (!configured()) redirect('/setup');
  const db = await supabase();
  const {
    data: { user },
  } = await db.auth.getUser();
  redirect(user ? next : `/login?next=${encodeURIComponent(next)}`);
}
