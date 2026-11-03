import { CategoryFilter } from '../../../src/features/expenses/category-filter';
import { CategoryLabel, CategorySummary } from '../../../src/features/expenses/category-summary';
import {
  categories,
  formatMoney,
  summarizeCategories,
  type Category,
} from '../../../src/features/expenses/money';
import { categoryNames, expenseMessages } from '../../../src/features/expenses/messages';
import { SectionDisclosure } from '../../../src/components/section-disclosure';
import type { Locale } from '../../../src/lib/i18n/dictionaries';

// Isolated component inputs from home-expenses-ui.test.ts; no backend or business writes.
export function ExpenseCategoriesFixture({
  category,
  locale,
}: {
  category?: Category;
  locale: Locale;
}) {
  const t = expenseMessages(locale);
  const rows = [
    { category: 'rent' as const, amount: '5000', title: 'Monthly rent' },
    { category: 'groceries' as const, amount: '2500', title: 'Groceries' },
  ].filter((row) => !category || row.category === category);
  const summary = summarizeCategories(rows);
  return (
    <main className="stack expenses" style={{ maxWidth: 960, padding: 24, margin: 'auto' }}>
      <h1>{t.movements}</h1>
      <CategoryFilter action="/">
        <input type="hidden" name="tab" value="expenses" />
        <label>
          {t.categoryFilter}
          <select name="category" defaultValue={category ?? ''}>
            <option value="">{t.allCategories}</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryNames[locale][c]}
              </option>
            ))}
          </select>
        </label>
        <noscript>
          <button type="submit">{t.applyFilter}</button>
        </noscript>
      </CategoryFilter>
      <p>
        {t.listedTotal}:{' '}
        <strong data-testid="total">{formatMoney(summary.total, 'EUR', locale)}</strong>
      </p>
      <SectionDisclosure title={t.categorySummary} defaultOpen>
        <p>{t.categorySummaryHelp}</p>
        <CategorySummary summary={summary} currency="EUR" locale={locale} />
      </SectionDisclosure>
      {rows.map((row) => (
        <section className="panel" key={row.category}>
          <h2>{row.title}</h2>
          <p>
            {formatMoney(row.amount, 'EUR', locale)} ·{' '}
            <CategoryLabel category={row.category} locale={locale} />
          </p>
        </section>
      ))}
    </main>
  );
}

export { categoryColors } from '../../../src/features/expenses/money';
