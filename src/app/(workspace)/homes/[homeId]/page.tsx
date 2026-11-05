import { CommunitySummary } from '@/features/community/summary';
import { ExpenseSummary } from '@/features/expenses/summary';
import Link from 'next/link';
import { UserPlus, ArrowUpRight, House } from 'lucide-react';
import { HomeMembers } from '@/components/home-members';
import { HomeSections } from '@/components/navigation';
import { getHome, getProfile, getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { OrganizationSummary } from '@/features/organization/summary';
import { UpcomingEvent } from '@/components/ui/upcoming-event';
export default async function HomePage({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const [home, profile, members, { user }, { t, locale }] = await Promise.all([
    getHome(homeId),
    getProfile(),
    getMembers(homeId),
    requireUser(),
    i18n(),
  ]);
  const image = await signedImage('home-images', home.image_path);
  return (
    <>
      <header className="page-head">
        <div className="home-heading">
          {image ? (
            <img className="mini-cover" src={image} alt="" width={40} height={40} />
          ) : (
            <div className="mini-cover" aria-hidden="true">
              <House size={24} />
            </div>
          )}
          <div>
            <h1>{home.name}</h1>
            <p>
              {t.greeting}, {profile.name}
            </p>
            {members.length === 1 && <p>{t.workspaceBody}</p>}
          </div>
        </div>
        <Link className="text-link home-invitation" href={`/homes/${homeId}/settings#invitation`}>
          <UserPlus size={18} aria-hidden="true" />
          {t.invitePeople}
        </Link>
      </header>
      <HomeSections homeId={homeId} t={t} />
      <div className="dashboard-summaries">
        <OrganizationSummary homeId={homeId} />
        <ExpenseSummary homeId={homeId} />
        <UpcomingEvent homeId={homeId} />
        <CommunitySummary homeId={homeId} />
      </div>
      <div className="dashboard-people">
        <HomeMembers members={members} currentUserId={user.id} t={t} locale={locale}>
          <Link className="text-link home-invitation" href={`/homes/${homeId}/settings`}>
            {t.homeSettings}
            <ArrowUpRight size={17} aria-hidden="true" />
          </Link>
        </HomeMembers>
      </div>
    </>
  );
}
