import { cookies } from 'next/headers';
import { dictionary, type Locale } from './dictionaries';
export async function i18n() {
  const jar = await cookies();
  const locale: Locale = jar.get('locale')?.value === 'en' ? 'en' : 'es';
  return {
    locale,
    t: dictionary(locale),
    theme: jar.get('theme')?.value === 'dark' ? 'dark' : 'light',
  };
}
