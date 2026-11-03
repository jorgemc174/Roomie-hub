import { createRoot } from 'react-dom/client';
import { ProfileForm } from '../../../src/app/(account)/profile/profile-form';
import { RegisterPasswords } from '../../../src/components/register-passwords';
import { es, en } from '../../../src/lib/i18n/dictionaries';
const locale = new URLSearchParams(location.search).get('locale') === 'en' ? 'en' : 'es';
const t = locale === 'en' ? en : es;
createRoot(document.getElementById('root')!).render(
  <>
    <a href="/other">Leave</a>
    <ProfileForm
      name="María Sol"
      email="self@example.test"
      image={null}
      hasImage={true}
      locale={locale}
      theme="light"
      t={t}
    />
    <form
      id="register"
      onSubmit={(event) => {
        event.preventDefault();
        document.documentElement.dataset.registered = 'true';
      }}
    >
      <RegisterPasswords t={t} />
      <button>Register</button>
    </form>
  </>,
);
