import Link from 'next/link';
import {
  CalendarDays,
  ListTodo,
  Wallet,
  Heart,
  MessageCircle,
  ArrowUpRight,
  UserPlus,
} from 'lucide-react';
import { getHome, getMembers, requireUser, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { OrganizationSummary } from '@/features/organization/summary';
const modules = [
  ['calendar', CalendarDays],
  ['organization', ListTodo],
  ['expenses', Wallet],
  ['community', Heart],
  ['chat', MessageCircle],
] as const;
export default async function HomePage({ params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const home = await getHome(homeId);
  const members = await getMembers(homeId);
  const { user } = await requireUser();
  const { t, locale } = await i18n();
  return (
    <>
      <header className="page-head">
        <div>
          <p className="eyebrow">{home.name}</p>
        </div>
        <span className="badge">{t.home}</span>
      </header>
      <section className="welcome-panel">
        <h1>{t.workspaceTitle}</h1>
        <p>{t.workspaceBody}</p>
        <Link className="button" href={`/homes/${homeId}/settings#invitation`}>
          <UserPlus size={18} />
          {t.invitation}
        </Link>
      </section>
      <OrganizationSummary homeId={homeId} />
      <div className="two-column">
        <section>
          <h2>{t.nextTitle}</h2>
          <div className="module-list">
            {modules.map(([key, Icon]) => (
              <Link className="module-row" href={`/homes/${homeId}/${key}`} key={key}>
                <span className="module-icon">
                  <Icon size={22} />
                </span>
                <div>
                  <h3>{t[key]}</h3>
                  <p>{t[`${key}Body`]}</p>
                </div>
                {key !== 'organization' && <span className="badge">{t.future}</span>}
              </Link>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="section-heading">
            <h2>{t.members}</h2>
            <span className="badge">{members.length}</span>
          </div>
          {await Promise.all(
            members.map(async (member) => {
              const image = await signedImage('avatars', member.profiles?.avatar_path ?? null);
              return (
                <div className="member-row" key={member.user_id}>
                  {image ? (
                    <img src={image} className="avatar" alt="" />
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
          <div className="equal">
            <h3>{t.equal}</h3>
            <p>{t.equalBody}</p>
          </div>
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
