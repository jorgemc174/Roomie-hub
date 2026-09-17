import Link from 'next/link';
import { getHome, getMembers, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import { ActionForm } from '@/components/action-form';
import { readRows as paginatedRows } from '@/features/organization/read-rows';
import { homeDate } from '@/lib/timezones';
import { expenseMessages, categoryNames } from './messages';
import { formatMoney, suggestPayments, inferCategory } from './money';
import { ExpenseForm } from './expense-form';
import { financeAction } from './actions';
import type { ExpenseBody, Expense, ExpenseSplit } from './models';
async function readRows<Row>(query: Parameters<typeof paginatedRows<Row>>[0]): Promise<Row[]> {
  const r = await paginatedRows(query);
  if (r.error) throw new Error('finance_read_failed');
  return r.data;
}
function ExpenseRevision({
  snapshot,
  locale,
}: {
  snapshot: import('./models').Json;
  locale: import('@/lib/i18n/dictionaries').Locale;
}) {
  const s = snapshot as unknown as { expense: Expense; splits: ExpenseSplit[] },
    t = expenseMessages(locale);
  return (
    <div>
      <p>
        {s.expense.title} · {formatMoney(s.expense.amount, s.expense.currency, locale)} ·{' '}
        {s.expense.payer_name}
      </p>
      <p>{s.expense.deleted_at ? t.deleted : t.saved}</p>
      <ul>
        {s.splits.map((p) => (
          <li key={p.user_id}>
            {p.user_name}: {formatMoney(p.amount, s.expense.currency, locale)}
          </li>
        ))}
      </ul>
    </div>
  );
}
function bodyFor(e: Expense, splits: ExpenseSplit[]): ExpenseBody {
  return {
    title: e.title,
    amount: String(e.amount),
    date: e.expense_date,
    payer: e.payer,
    category: e.category,
    split_mode: e.split_mode,
    participants: splits
      .filter((s) => s.expense_id === e.id)
      .map((s) => ({ user_id: s.user_id, weight: String(s.weight) })),
  };
}
export async function ExpensesPage({
  homeId,
  search,
}: {
  homeId: string;
  search: Record<string, string | string[] | undefined>;
}) {
  const home = await getHome(homeId),
    { db, user } = await requireUser(),
    { locale } = await i18n(),
    t = expenseMessages(locale),
    today = homeDate(home.timezone),
    base = `/homes/${homeId}/expenses`;
  const generated = await db.rpc('generate_recurring_expenses', { target: homeId });
  if (generated.error)
    return (
      <section className="panel">
        <h1>{t.title}</h1>
        <p role="alert" className="notice error">
          {['PGRST202', '42P01'].includes(generated.error.code) ? t.migration : t.error}
        </p>
      </section>
    );
  const tab =
    typeof search.tab === 'string' &&
    ['expenses', 'balances', 'recurring', 'history'].includes(search.tab)
      ? search.tab
      : 'expenses';
  const page =
    typeof search.page === 'string' && /^\d{1,6}$/.test(search.page)
      ? Math.max(0, Number(search.page))
      : 0;
  async function readPage<Row>(query: Parameters<typeof paginatedRows<Row>>[0]): Promise<Row[]> {
    const result = await query.range(page * 50, page * 50 + 49);
    if (result.error) throw new Error('finance_read_failed');
    return result.data ?? [];
  }
  // Fetch only the displayed window; balances remain computed from the complete exact ledger.
  const expenses =
    tab === 'expenses'
      ? await readPage(
          db
            .from('expenses')
            .select('*')
            .eq('home_id', homeId)
            .is('deleted_at', null)
            .order('expense_date', { ascending: false })
            .order('id'),
        )
      : [];
  const expenseIds = expenses.map((e) => e.id);
  const [splits, payments, recurring, occurrences, receipts, events, links, members] =
    await Promise.all([
      expenseIds.length
        ? readRows(
            db
              .from('expense_splits')
              .select('*')
              .eq('home_id', homeId)
              .in('expense_id', expenseIds)
              .order('expense_id')
              .order('user_id'),
          )
        : [],
      tab === 'balances'
        ? readPage(
            db
              .from('settlements')
              .select('*')
              .eq('home_id', homeId)
              .order('payment_date', { ascending: false })
              .order('id'),
          )
        : [],
      tab === 'recurring'
        ? readPage(
            db
              .from('recurring_expenses')
              .select('*')
              .eq('home_id', homeId)
              .order('next_date')
              .order('id'),
          )
        : [],
      tab === 'recurring'
        ? readPage(
            db
              .from('recurring_expense_instances')
              .select('*')
              .eq('home_id', homeId)
              .eq('status', 'pending')
              .order('period_date')
              .order('id'),
          )
        : [],
      expenseIds.length
        ? readRows(
            db
              .from('expense_attachments')
              .select('*')
              .eq('home_id', homeId)
              .in('expense_id', expenseIds)
              .order('id'),
          )
        : [],
      tab === 'history'
        ? readPage(
            db
              .from('expense_events')
              .select('*')
              .eq('home_id', homeId)
              .order('recorded_at', { ascending: false })
              .order('id'),
          )
        : [],
      typeof search.shopping === 'string'
        ? readRows(
            db
              .from('shopping_list_expense_links')
              .select('*')
              .eq('home_id', homeId)
              .eq('shopping_list_id', search.shopping)
              .order('shopping_list_id'),
          )
        : [],
      getMembers(homeId),
    ]);
  const hasNext = [expenses, payments, recurring, occurrences, events].some(
    (rows) => rows.length === 50,
  );
  const balanceResult = await db.rpc('expense_balances', { target: homeId });
  if (balanceResult.error) throw new Error('expense_balance_read_failed');
  const balances = balanceResult.data;
  const me = balances.find((b) => b.user_id === user.id)?.balance ?? '0',
    suggestions = suggestPayments(balances),
    people = members.map((m) => ({ id: m.user_id, name: m.profiles?.name ?? 'Roomie' }));
  const props = {
    homeId,
    currency: home.currency,
    locale,
    today,
    userId: user.id,
    members: people,
  };
  const date = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
      new Date(d + 'T12:00:00Z'),
    );
  let initial: ExpenseBody | undefined;
  let shoppingList: string | undefined;
  let shoppingError = false;
  if (typeof search.shopping === 'string') {
    const list = await db
      .from('shopping_lists')
      .select('*')
      .eq('home_id', homeId)
      .eq('id', search.shopping)
      .maybeSingle();
    if (
      list.error ||
      !list.data?.completed_at ||
      list.data.deleted_at ||
      links.some((l) => l.shopping_list_id === search.shopping)
    )
      shoppingError = true;
    else {
      shoppingList = list.data.id;
      initial = {
        title: list.data.name,
        amount: '',
        date: today,
        payer: user.id,
        category: inferCategory(list.data.name),
        split_mode: 'equal',
        participants: people.map((p) => ({ user_id: p.id, weight: '1' })),
      };
    }
  }
  return (
    <div className="stack">
      <header className="page-head">
        <h1>{t.title}</h1>
        <span className="badge">{home.currency}</span>
      </header>
      <section className="panel">
        <h2>{t.balance}</h2>
        <strong>
          {BigInt(me) === 0n
            ? t.zero
            : `${BigInt(me) > 0n ? t.owed : t.owe} ${formatMoney(BigInt(me) < 0n ? -BigInt(me) : me, home.currency, locale)}`}
        </strong>
      </section>
      <nav className="org-tabs" aria-label={t.title}>
        {[
          ['expenses', t.title],
          ['balances', t.balances],
          ['recurring', t.recurring],
          ['history', t.history],
        ].map(([key, label]) => (
          <Link
            className="button secondary"
            key={key}
            href={`${base}?tab=${key}`}
            aria-current={tab === key ? 'page' : undefined}
          >
            {label}
          </Link>
        ))}
      </nav>
      {tab === 'expenses' && (
        <>
          <section className="panel">
            <h2>{shoppingList ? t.shopping : t.newExpense}</h2>
            {shoppingError ? (
              <p className="notice error">{t.listIncomplete}</p>
            ) : (
              <ExpenseForm
                {...props}
                id={crypto.randomUUID()}
                initial={initial}
                shoppingList={shoppingList}
              />
            )}
          </section>
          {!expenses.some((e) => !e.deleted_at) && <p>{t.empty}</p>}
          {expenses
            .filter((e) => !e.deleted_at)
            .map((e) => (
              <section className="panel" key={e.id}>
                <div className="section-heading">
                  <h2>{e.title}</h2>
                  <strong>{formatMoney(e.amount, e.currency, locale)}</strong>
                </div>
                <p>
                  {date(e.expense_date)} · {e.payer_name} · {categoryNames[locale][e.category]}
                </p>
                <ul>
                  {splits
                    .filter((s) => s.expense_id === e.id)
                    .map((s) => (
                      <li key={s.user_id}>
                        {s.user_name}: {formatMoney(s.amount, e.currency, locale)}
                      </li>
                    ))}
                </ul>
                {receipts
                  .filter((r) => r.expense_id === e.id)
                  .map((r) => (
                    <p key={r.id}>
                      <Link
                        href={`${base}/receipt/${r.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t.download}
                      </Link>
                    </p>
                  ))}
                <details>
                  <summary>{t.edit}</summary>
                  <ExpenseForm
                    {...props}
                    id={e.id}
                    version={e.version}
                    initial={bodyFor(e, splits)}
                    members={[
                      ...people,
                      ...splits
                        .filter(
                          (s) => s.expense_id === e.id && !people.some((p) => p.id === s.user_id),
                        )
                        .map((s) => ({ id: s.user_id, name: `${s.user_name} · ${t.former}` })),
                      ...(!people.some((p) => p.id === e.payer) &&
                      !splits.some((s) => s.expense_id === e.id && s.user_id === e.payer)
                        ? [{ id: e.payer, name: `${e.payer_name} · ${t.former}` }]
                        : []),
                    ]}
                  />
                </details>
                <details>
                  <summary>{t.delete}</summary>
                  <ActionForm
                    action={financeAction.bind(null, homeId, 'delete')}
                    label={t.delete}
                    pendingLabel={t.saving}
                    danger
                  >
                    <input type="hidden" name="id" value={e.id} />
                    <input type="hidden" name="version" value={e.version} />
                    <label className="checkbox">
                      <input type="checkbox" name="confirm" required />
                      {t.confirmDelete}
                    </label>
                  </ActionForm>
                </details>
              </section>
            ))}
        </>
      )}
      {tab === 'balances' && (
        <>
          <section className="panel">
            <h2>{t.balances}</h2>
            {balances.map((b) => (
              <p key={b.user_id}>
                {b.name}
                {b.active ? '' : ` · ${t.former}`}{' '}
                <strong>{formatMoney(b.balance, home.currency, locale)}</strong>
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>{t.suggestions}</h2>
            <p>{t.suggestionHelp}</p>
            {suggestions.map((p, i) => (
              <p key={i}>
                {balances.find((b) => b.user_id === p.from)?.name} →{' '}
                {balances.find((b) => b.user_id === p.to)?.name}:{' '}
                <strong>{formatMoney(p.amount, home.currency, locale)}</strong>
              </p>
            ))}
          </section>
          <section className="panel">
            <h2>{t.recordPayment}</h2>
            <ActionForm
              action={financeAction.bind(null, homeId, 'payment')}
              label={t.recordPayment}
              pendingLabel={t.saving}
            >
              <input type="hidden" name="id" value={crypto.randomUUID()} />
              <label>
                {t.sender}
                <select name="sender" defaultValue={user.id}>
                  {balances
                    .filter((b) => b.active || BigInt(b.balance) < 0n)
                    .map((b) => (
                      <option key={b.user_id} value={b.user_id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.recipient}
                <select
                  name="recipient"
                  defaultValue={
                    suggestions.find((s) => s.from === user.id)?.to ??
                    balances.find((b) => b.user_id !== user.id)?.user_id
                  }
                >
                  {balances
                    .filter((b) => b.active || BigInt(b.balance) > 0n)
                    .map((b) => (
                      <option key={b.user_id} value={b.user_id}>
                        {b.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                {t.amount}
                <input name="amount" inputMode="decimal" required />
              </label>
              <label>
                {t.date}
                <input name="date" type="date" defaultValue={today} required />
              </label>
            </ActionForm>
          </section>
          <section className="panel">
            <h2>{t.payments}</h2>
            {payments.map((p) => (
              <p key={p.id}>
                {date(p.payment_date)} · {p.from_name} → {p.to_name}:{' '}
                {formatMoney(p.amount, p.currency, locale)}
              </p>
            ))}
          </section>
        </>
      )}
      {tab === 'recurring' && (
        <>
          <p>{t.recurrenceHelp}</p>
          {generated.data.more && <p className="notice">{t.more}</p>}
          <ActionForm
            action={financeAction.bind(null, homeId, 'generate')}
            label={t.generate}
            pendingLabel={t.saving}
          />
          <details className="panel">
            <summary>{t.newRecurring}</summary>
            <ExpenseForm {...props} operation="recurring" id={crypto.randomUUID()} />
          </details>
          {occurrences
            .filter((i) => i.status === 'pending')
            .map((i) => (
              <section className="panel" key={i.id} id={`occurrence-${i.id}`}>
                <h2>
                  {i.template.title} · {date(i.period_date)}
                </h2>
                <p>{t.pending}</p>
                <ExpenseForm
                  {...props}
                  operation="confirm"
                  id={i.id}
                  initial={{
                    ...i.template,
                    amount: i.recurrence_kind === 'variable' ? '' : i.template.amount,
                    payer: people.some((p) => p.id === i.template.payer)
                      ? i.template.payer
                      : user.id,
                    participants: i.template.participants.filter((p) =>
                      people.some((m) => m.id === p.user_id),
                    ),
                  }}
                />
              </section>
            ))}
          {recurring.map((r) => (
            <details className="panel" key={r.id} id={`recurring-${r.id}`}>
              <summary>
                {r.template.title} · {r.active ? t.active : t.inactive} · {t.next}:{' '}
                {date(r.next_date)}
              </summary>
              <ExpenseForm
                {...props}
                operation="recurring"
                id={r.id}
                version={r.version}
                recurring={r}
                initial={r.template}
              />
            </details>
          ))}
        </>
      )}
      {tab === 'history' && (
        <section className="panel">
          <h2>{t.audit}</h2>
          <p>{t.deletedHelp}</p>
          {events.map((e) => (
            <details key={e.id}>
              <summary>
                {(e.snapshot as unknown as { expense: Expense }).expense.title} · {t.version}{' '}
                {e.revision} · {e.actor_name}
              </summary>
              <ExpenseRevision snapshot={e.snapshot} locale={locale} />
            </details>
          ))}
        </section>
      )}
      <nav className="row wrap" aria-label={t.pages}>
        {page > 0 && (
          <Link className="button secondary" href={`${base}?tab=${tab}&page=${page - 1}`}>
            {t.previousPage}
          </Link>
        )}
        {hasNext && (
          <Link className="button secondary" href={`${base}?tab=${tab}&page=${page + 1}`}>
            {t.nextPage}
          </Link>
        )}
      </nav>
    </div>
  );
}
