import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { config } from '@/lib/supabase/config';
import type { Database } from '@/lib/supabase/database.types';
import { authDestination, googleCallbackFailurePath, siteOrigin } from '@/lib/auth-redirects';
import { importGoogleAvatar } from '@/lib/google-profile';
export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  const next = request.nextUrl.searchParams.get('next');
  const providerError = request.nextUrl.searchParams.get('error');
  const origin = siteOrigin();
  const response = NextResponse.redirect(
    new URL(googleCallbackFailurePath(next, providerError, Boolean(code)), origin),
  );
  response.headers.set('Cache-Control', 'private, no-cache, no-store, must-revalidate, max-age=0');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');
  response.headers.set('Referrer-Policy', 'no-referrer');
  if (code && providerError === null) {
    try {
      const { url, key } = config();
      // Write onto the returned redirect, including the SDK's cache headers.
      // Unlike a Server Component, a Route Handler must not swallow cookie failures.
      const db = createServerClient<Database>(url, key, {
        cookies: {
          getAll: () => request.cookies.getAll(),
          setAll(values, headers) {
            values.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options),
            );
            Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
          },
        },
      });
      const flowId = request.nextUrl.searchParams.get('sb_flow_id');
      const { data, error } = await db.auth.exchangeCodeForSession(
        code,
        flowId === null ? undefined : { flowId },
      );
      if (!error) {
        response.headers.set('Location', new URL(authDestination(next), origin).toString());
        if (data.user) await importGoogleAvatar(db, data.user);
      }
    } catch {
      // A failed exchange must leave the invitation available for another attempt.
    }
  }
  return response;
}
