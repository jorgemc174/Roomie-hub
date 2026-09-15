import Link from 'next/link';
import { Brand } from './brand';
import { ActionForm } from './action-form';
import { logoutAction } from '@/app/actions';
import type { Messages } from '@/lib/i18n/dictionaries';
export function Topbar({ t, homeId }: { t: Messages; homeId?: string }) {
  return (
    <header className="topbar">
      <Brand />
      {homeId && (
        <Link className="mobile-brand" href="/homes">
          {t.homes}
        </Link>
      )}
      <nav aria-label={t.settings}>
        {homeId && <Link href={`/homes/${homeId}/settings`}>{t.homeSettings}</Link>}
        <Link href="/profile">{t.personal}</Link>
        <ActionForm action={logoutAction} label={t.logout} pendingLabel={t.saving} />
      </nav>
    </header>
  );
}
