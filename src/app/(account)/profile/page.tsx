import { PageHeader } from '@/components/ui/page-header';
import Link from 'next/link';
import { Logout } from '@/components/logout';
import { notificationMessages } from '@/features/notifications/messages';
import { getProfile, signedImage, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { ProfileForm } from './profile-form';
import { AccountLink } from '@/components/account-navigation';
export default async function Profile() {
  const profile = await getProfile();
  const { user } = await requireUser();
  const prefs = await i18n();
  const { t } = prefs;
  const image = await signedImage('avatars', profile.avatar_path);
  return (
    <div className="narrow">
      <PageHeader title={t.personal} description={t.profileBody} />
      <section className="panel profile-account-actions">
        <Link href="/homes" className="button secondary">
          {t.homes}
        </Link>
        <AccountLink href="/notifications/preferences">
          {notificationMessages(prefs.locale).preferences}
        </AccountLink>
        <Logout label={t.logout} pendingLabel={t.saving} errorLabel={t.requestError} />
      </section>
      <section className="panel">
        <ProfileForm
          name={profile.name}
          email={user.email ?? ''}
          image={image}
          hasImage={!!profile.avatar_path}
          {...prefs}
        />
      </section>
    </div>
  );
}
