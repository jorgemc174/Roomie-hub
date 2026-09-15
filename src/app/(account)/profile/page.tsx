import Link from 'next/link';
import { getProfile, signedImage } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { profileAction } from '@/app/actions';
import { ActionForm } from '@/components/action-form';
import { PreferenceFields } from '@/components/preferences';
export default async function Profile() {
  const profile = await getProfile();
  const prefs = await i18n();
  const { t } = prefs;
  const image = await signedImage('avatars', profile.avatar_path);
  return (
    <div className="narrow">
      <Link href="/homes" className="back-link">
        ← {t.homes}
      </Link>
      <header className="page-head">
        <div>
          <h1>{t.personal}</h1>
          <p>{t.profileBody}</p>
        </div>
      </header>
      <section className="panel">
        <ActionForm action={profileAction} label={t.save} pendingLabel={t.saving}>
          {image && <img src={image} alt={t.photo} className="image-preview profile-photo" />}
          <label>
            {t.name}
            <input
              name="name"
              defaultValue={profile.name}
              required
              minLength={2}
              maxLength={80}
              autoComplete="name"
            />
          </label>
          <label>
            {t.photo}
            <input name="image" type="file" accept="image/jpeg,image/png,image/webp" />
            <small>{t.imageHint}</small>
          </label>
          {profile.avatar_path && (
            <label className="checkbox">
              <input type="checkbox" name="remove_image" />
              {t.removeImage}
            </label>
          )}
          <PreferenceFields {...prefs} />
        </ActionForm>
      </section>
    </div>
  );
}
