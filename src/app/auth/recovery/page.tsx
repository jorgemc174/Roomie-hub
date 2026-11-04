import { i18n } from '@/lib/i18n/server';
import { RecoverySession } from './recovery-session';

export default async function Recovery() {
  const { t } = await i18n();
  return (
    <main id="main" className="auth-main">
      <RecoverySession loading={t.loading} />
    </main>
  );
}
