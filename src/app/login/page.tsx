import { AuthScreen } from '@/components/auth-screen';
export default async function Login({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  return <AuthScreen kind="login" {...await searchParams} />;
}
