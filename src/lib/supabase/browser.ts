'use client';
import { createBrowserClient } from '@supabase/ssr';
import { config } from './config';
import type { Database } from './database.types';
export function browserClient() {
  const { url, key } = config();
  return createBrowserClient<Database>(url, key);
}
