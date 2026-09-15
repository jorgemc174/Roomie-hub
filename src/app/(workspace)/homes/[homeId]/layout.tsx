import Link from 'next/link';
import { ArrowLeft, Settings, House } from 'lucide-react';
import { getHome, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { Brand } from '@/components/brand';
import { Navigation } from '@/components/navigation';
import { Topbar } from '@/components/topbar';
import { HomeSync } from '@/features/realtime/home-sync';
export default async function WorkspaceLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ homeId: string }>;
}) {
  const { homeId } = await params;
  const home = await getHome(homeId);
  const { t } = await i18n();
  const image = await signedImage('home-images', home.image_path);
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="home-label">
          {image ? (
            <img className="mini-cover" src={image} alt="" />
          ) : (
            <span className="mini-cover">
              <House size={21} />
            </span>
          )}
          <strong>{home.name}</strong>
        </div>
        <Navigation homeId={homeId} t={t} />
        <div className="sidebar-bottom">
          <Link href={`/homes/${homeId}/settings`}>
            <Settings size={18} />
            {t.homeSettings}
          </Link>
          <Link href="/homes">
            <ArrowLeft size={18} />
            {t.homes}
          </Link>
        </div>
      </aside>
      <div className="workspace">
        <Topbar t={t} homeId={homeId} />
        <main id="main" className="page">
          {children}
        </main>
      </div>
      <HomeSync homeId={homeId} />
    </div>
  );
}
