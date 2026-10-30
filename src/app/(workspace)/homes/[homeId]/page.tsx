import { QuickActions } from '@/components/ui/quick-actions';
import { CommunitySummary } from '@/features/community/summary';
import { ExpenseSummary } from '@/features/expenses/summary';
import Link from 'next/link';
import { UserPlus, ArrowUpRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/page-header';
import { getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { OrganizationSummary } from '@/features/organization/summary';
export default async function HomePage({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const [members, { user }, { t, locale }] = await Promise.all([
    getMembers(homeId),
    requireUser(),
    i18n(),
  ]);
  return (
    <>
      <PageHeader
        title={t.dashboard}
        description={members.length === 1 ? t.workspaceBody : undefined}
        action={
          <Link className="button secondary" href={`/homes/${homeId}/settings#invitation`}>
            <UserPlus size={18} aria-hidden="true" />
            {t.invitePeople}
          </Link>
        }
      />
      <QuickActions homeId={homeId} locale={locale} label={t.dashboard} />
      <div className="dashboard-summaries">
        <OrganizationSummary homeId={homeId} />
        <ExpenseSummary homeId={homeId} />
        <CommunitySummary homeId={homeId} />
      </div>
      <div className="dashboard-people">
        <section className="panel">
          <div className="section-heading">
            <h2>{t.members}</h2>
            <span className="badge">{members.length}</span>
          </div>
          <div className="dashboard-member-list">
            {await Promise.all(
              members.map(async (member) => {
                const image = await signedImage('avatars', member.profiles?.avatar_path ?? null);
                return (
                  <div className="member-row" key={member.user_id}>
                    {image ? (
                      <img
                        src={image}
                        className="avatar"
                        alt=""
                        width={44}
                        height={44}
                        loading="lazy"
                      />
                    ) : (
                      <span className="avatar">{member.profiles?.name.slice(0, 1)}</span>
                    )}
                    <div>
                      <strong>
                        {member.profiles?.name}
                        {member.user_id === user.id ? ` · ${t.you}` : ''}
                      </strong>
                      <small>
                        {t.memberSince}{' '}
                        {new Intl.DateTimeFormat(locale, {
                          month: 'short',
                          year: 'numeric',
                          timeZone: 'UTC',
                        }).format(new Date(member.joined_at))}
                      </small>
                    </div>
                  </div>
                );
              }),
            )}
          </div>
          <details className="ui-help">
            <summary>{t.equal}</summary>
            <p>{t.equalBody}</p>
          </details>
          <Link
            className="text-link"
            style={{ display: 'inline-flex', gap: 8, marginTop: 20 }}
            href={`/homes/${homeId}/settings`}
          >
            {t.homeSettings}
            <ArrowUpRight size={17} />
          </Link>
        </section>
      </div>
    </>
  );
}
