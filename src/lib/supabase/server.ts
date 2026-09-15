import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { config } from './config';
import type { Database } from './database.types';
export async function supabase() {
  const jar = await cookies();
  const { url, key } = config();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => jar.getAll(),
      setAll(values) {
        try {
          values.forEach(({ name, value, options }) => jar.set(name, value, options));
        } catch {
          /* Server Components cannot write cookies; proxy refreshes them. */
        }
      },
    },
  });
}
