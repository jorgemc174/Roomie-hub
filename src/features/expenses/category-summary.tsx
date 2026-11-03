import type { Locale } from '@/lib/i18n/dictionaries';
import { categoryColors, formatMoney, type Category, type summarizeCategories } from './money';
import { categoryNames, expenseMessages } from './messages';

export function CategoryLabel({ category, locale }: { category: Category; locale: Locale }) {
  return (
    <span className="expense-category" style={{ color: categoryColors[category] }}>
      <span className="expense-category-dot" aria-hidden="true" />
      {categoryNames[locale][category]}
    </span>
  );
}

export function CategorySummary({
  summary,
  currency,
  locale,
}: {
  summary: ReturnType<typeof summarizeCategories>;
  currency: string;
  locale: Locale;
}) {
  const percent = new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return (
    <ul className="expense-category-chart" aria-label={expenseMessages(locale).categorySummary}>
      {summary.categories.map((row) => (
        <li key={row.category}>
          <div className="expense-category-heading">
            <CategoryLabel category={row.category} locale={locale} />
            <span className="expense-category-value">
              {formatMoney(row.amount, currency, locale)} ·{' '}
              {percent.format(Number(row.basisPoints) / 10000)}
            </span>
          </div>
          <div className="expense-category-track" aria-hidden="true">
            <span
              style={{
                width: `${Number(row.basisPoints) / 100}%`,
                background: categoryColors[row.category],
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
