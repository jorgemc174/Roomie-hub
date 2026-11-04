import { NextResponse, type NextRequest } from 'next/server';
import { supabase } from '@/lib/supabase/server';
import {
  authDestination,
  authFailurePath,
  emailConfirmation,
  siteOrigin,
} from '@/lib/auth-redirects';
export async function GET(request: NextRequest) {
  const next = request.nextUrl.searchParams.get('next');
  const link = emailConfirmation(request.nextUrl.searchParams);
  if (link.kind === 'otp') {
    const db = await supabase();
    const { error } = await db.auth.verifyOtp({ token_hash: link.tokenHash, type: link.type });
    if (!error)
      return NextResponse.redirect(new URL(authDestination(next, link.type), siteOrigin()));
  } else if (link.kind === 'code') {
    // Default templates verify in Supabase and return a PKCE code; `next` already names the
    // destination (/reset-password for recovery). Needs the verifier cookie of this browser.
    const db = await supabase();
    const { error } = await db.auth.exchangeCodeForSession(link.code);
    if (!error) return NextResponse.redirect(new URL(authDestination(next), siteOrigin()));
  }
  return NextResponse.redirect(new URL(authFailurePath(next), siteOrigin()));
}
