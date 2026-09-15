import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { authDestination, authFailurePath, siteOrigin } from '@/lib/auth-redirects';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = request.nextUrl.searchParams.get('next');
  if (code) {
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(authDestination(next), siteOrigin()));
  }
  return NextResponse.redirect(new URL(authFailurePath(next), siteOrigin()));
}
