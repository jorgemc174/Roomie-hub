import { AuthScreen } from '@/components/auth-screen';
import { requireUser } from '@/lib/data';
export default async function Reset() {
  await requireUser();
  return <AuthScreen kind="reset" />;
}
