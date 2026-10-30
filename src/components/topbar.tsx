import Link from 'next/link';
import { Settings, UserRound } from 'lucide-react';
import { NotificationBell } from '@/features/notifications/inbox';
import { Brand } from './brand';
import { AccountLink } from './account-navigation';
import type { Messages } from '@/lib/i18n/dictionaries';
export function Topbar({
  t,
  homeId,
  homeName,
}: {
  t: Messages;
  homeId?: string;
  homeName?: string;
}) {
  return (
    <header className="topbar">
      {homeId && homeName ? (
        <Link className="workspace-identity" href={`/homes/${homeId}`}>
          <span className="eyebrow">{t.brand}</span>
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
          <UserRound size={20} aria-hidden="true" />
          <span>{t.personal}</span>
        </AccountLink>
      </nav>
    </header>
  );
}
