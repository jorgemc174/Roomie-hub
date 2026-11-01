import type { ReactNode } from 'react';
import type { Locale } from '@/lib/i18n/dictionaries';
import type { Occurrence } from './models';
import { expenseMessages } from './messages';
import { formatMoney } from './money';

export function PendingOccurrence({
  occurrence,
  currency,
  locale,
  children,
}: {
  occurrence: Occurrence;
  currency: string;
  locale: Locale;
  children: ReactNode;
}) {
  const t = expenseMessages(locale);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(`${occurrence.period_date}T12:00:00Z`),
  );
  return (
    <details className="panel" id={`occurrence-${occurrence.id}`}>
      <summary>
        <strong>{occurrence.template.title}</strong> · {date} ·{' '}
        <span className="badge recurring">
          {occurrence.recurrence_kind === 'variable'
            ? t.variable
            : formatMoney(occurrence.template.amount, currency, locale)}
        </span>{' '}
        <span className="text-link">{t.confirm}</span>
      </summary>
      <p>{t.pending}</p>
      {children}
    </details>
  );
}
