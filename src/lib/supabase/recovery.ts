import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { config } from './config';

/** Used only to request recovery emails, without a browser-bound PKCE verifier. */
export function recoveryClient() {
  const { url, key } = config();
  return createClient(url, key, {
    auth: {
      flowType: 'implicit',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
