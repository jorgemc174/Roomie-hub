import { redirect } from 'next/navigation';
import { configured } from '@/lib/supabase/config';
import { i18n } from '@/lib/i18n/server';
import { Brand } from '@/components/brand';
import { Preferences } from '@/components/preferences';
export default async function Setup() {
  if (configured()) redirect('/homes');
  const prefs = await i18n();
  const { t } = prefs;
  return (
    <main id="main" className="setup">
      <div className="panel">
        <Brand />
        <p className="eyebrow" style={{ marginTop: 32 }}>
          {t.setupLabel}
        </p>
        <h1>{t.setupTitle}</h1>
        <p>{t.setupBody}</p>
        <p>{t.setupHelp}</p>
        <pre>
          NEXT_PUBLIC_SUPABASE_URL
          <br />
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
          <br />
          NEXT_PUBLIC_SITE_URL
        </pre>
        <Preferences {...prefs} />
      </div>
    </main>
  );
}
