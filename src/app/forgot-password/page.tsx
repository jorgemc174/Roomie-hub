import { AuthScreen } from '@/components/auth-screen';
export default async function Recover({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const { next } = await searchParams;
  return <AuthScreen kind="recover" next={typeof next === 'string' ? next : undefined} />;
}
