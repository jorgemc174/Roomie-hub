import { requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { Topbar } from '@/components/topbar';
export default async function Layout({ children }: { children: React.ReactNode }) {
  await requireUser();
  const { t } = await i18n();
  return (
    <>
      <Topbar t={t} />
      <main id="main" className="page">
        {children}
      </main>
    </>
  );
}
