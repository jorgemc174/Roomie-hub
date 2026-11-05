import Link from 'next/link';
import { Settings } from 'lucide-react';
import { NotificationBell } from '@/features/notifications/inbox';
import { getProfile, signedImage } from '@/lib/data';
import { avatarInitials } from '@/lib/profile-validation';
import { Brand } from './brand';
import { AccountLink } from './account-navigation';
import type { Messages } from '@/lib/i18n/dictionaries';
export async function Topbar({
  t,
  homeId,
  homeName,
}: {
  t: Messages;
  homeId?: string;
  homeName?: string;
}) {
  const profile = await getProfile();
  const image = await signedImage('avatars', profile.avatar_path);
  return (
    <header className="topbar">
      {homeId && homeName ? (
        <Link className="workspace-identity" href={`/homes/${homeId}`}>
          <span className="workspace-brand">{t.brand}</span>
          <strong>{homeName}</strong>
        </Link>
      ) : (
        <Brand href="/homes" />
      )}
      <nav aria-label={t.settings}>
        {homeId && (
          <Link
            className="topbar-action"
            href={`/homes/${homeId}/settings`}
            aria-label={t.homeSettings}
          >
            <Settings size={20} aria-hidden="true" />
            <span>{t.homeSettings}</span>
          </Link>
        )}
        <NotificationBell />
        <AccountLink className="topbar-action" href="/profile" aria-label={t.personal}>
          {image ? (
            <img className="avatar" src={image} alt="" width={44} height={44} />
          ) : (
            <div className="avatar" aria-hidden="true">
              {avatarInitials(profile.name)}
            </div>
          )}
          <span className="topbar-profile-name">{profile.name}</span>
        </AccountLink>
      </nav>
    </header>
  );
}
