import Link from 'next/link';
import { Brand } from './brand';
import type { Messages } from '@/lib/i18n/dictionaries';
export function Topbar({ t, homeId }: { t: Messages; homeId?: string }) {
  return (
    <header className="topbar">
      <Brand href={homeId ? `/homes/${homeId}` : '/homes'} />
      <nav aria-label={t.settings}>
        {homeId && <Link href={`/homes/${homeId}/settings`}>{t.homeSettings}</Link>}
        <Link href="/profile">{t.personal}</Link>
      </nav>
    </header>
  );
}
