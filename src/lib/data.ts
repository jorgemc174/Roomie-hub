import { redirect, notFound } from 'next/navigation';
import { configured } from './supabase/config';
import { supabase } from './supabase/server';
import type { Home, Profile, Member } from './models';
export async function requireUser() {
  if (!configured()) redirect('/setup');
  const db = await supabase();
  const {
    data: { user },
    error,
  } = await db.auth.getUser();
  if (error || !user) redirect('/login');
  return { db, user };
}
export async function getProfile() {
  const { db, user } = await requireUser();
  const { data, error } = await db.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw new Error('profile_read_failed');
  return data as Profile;
}
export async function getHome(id: string) {
  const { db } = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { data, error } = await db.from('homes').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error('home_read_failed');
  if (!data) notFound();
  return data as Home;
}
export async function getMembers(id: string) {
  const { db } = await requireUser();
  const { data, error } = await db
    .from('home_members')
    .select('user_id,active,joined_at,profiles(name,avatar_path)')
    .eq('home_id', id)
    .eq('active', true)
    .order('joined_at');
  if (error) throw new Error('members_read_failed');
  return data as unknown as Member[];
}
export async function signedImage(bucket: 'avatars' | 'home-images', path: string | null) {
  if (!path) return null;
  const db = await supabase();
  const { data } = await db.storage.from(bucket).createSignedUrl(path, 300);
  return data?.signedUrl ?? null;
}
