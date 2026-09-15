import { setPreferences } from '@/app/actions';
import type { Messages, Locale } from '@/lib/i18n/dictionaries';
export function PreferenceFields({
  t,
  locale,
  theme,
}: {
  t: Messages;
  locale: Locale;
  theme: string;
}) {
  return (
    <div className="form-row">
      <label>
        {t.language}
        <select name="locale" defaultValue={locale}>
          <option value="es">{t.spanish}</option>
          <option value="en">{t.english}</option>
        </select>
      </label>
      <label>
        {t.theme}
        <select name="theme" defaultValue={theme}>
          <option value="light">{t.light}</option>
          <option value="dark">{t.dark}</option>
        </select>
      </label>
    </div>
  );
}
export function Preferences(props: { t: Messages; locale: Locale; theme: string }) {
  return (
    <details className="preferences">
      <summary>{props.t.preferences}</summary>
      <form action={setPreferences}>
        <PreferenceFields {...props} />
        <button className="button secondary">{props.t.save}</button>
      </form>
    </details>
  );
}
