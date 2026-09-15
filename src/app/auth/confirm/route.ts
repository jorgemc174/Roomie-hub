import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import { authDestination, authFailurePath, siteOrigin } from '@/lib/auth-redirects';
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get('token_hash');
  const type = request.nextUrl.searchParams.get('type');
  const next = request.nextUrl.searchParams.get('next');
  if (token_hash && (type === 'email' || type === 'signup' || type === 'recovery')) {
    const db = await supabase();
    const { error } = await db.auth.verifyOtp({ token_hash, type });
    if (!error) return NextResponse.redirect(new URL(authDestination(next, type), siteOrigin()));
  }
  return NextResponse.redirect(new URL(authFailurePath(next), siteOrigin()));
}
