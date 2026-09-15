import { redirect } from 'next/navigation';
import { configured } from '@/lib/supabase/config';
export default function Page() {
  redirect(configured() ? '/homes' : '/setup');
}
