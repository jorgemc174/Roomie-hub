import type { ReactNode } from 'react';
import type { Member } from '@/lib/models';
import type { Messages } from '@/lib/i18n/dictionaries';
import { signedImage } from '@/lib/data';
import { avatarInitials } from '@/lib/profile-validation';

export async function HomeMembers({
  members,
  currentUserId,
  t,
  locale,
  children,
}: {
  members: Member[];
  currentUserId: string;
  t: Messages;
  locale: string;
  children?: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{t.members}</h2>
        <span className="badge">{members.length}</span>
      </div>
      <div className="dashboard-member-list">
        {await Promise.all(
          members.map(async (member) => {
            const name = member.profiles?.name ?? '';
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
                  <span className="avatar">{avatarInitials(name)}</span>
                )}
                <div>
                  <strong>
                    {name}
                    {member.user_id === currentUserId ? ` · ${t.you}` : ''}
                  </strong>
                  <small>
                    {t.memberSince}{' '}
                    {new Intl.DateTimeFormat(locale, {
                      day: 'numeric',
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
      {children}
    </section>
  );
}
