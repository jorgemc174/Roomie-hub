import { AuthScreen } from '@/components/auth-screen';
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  return <AuthScreen kind="register" {...await searchParams} />;
}
