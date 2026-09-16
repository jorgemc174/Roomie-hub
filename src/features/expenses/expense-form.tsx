'use client';
import { useActionState, useState } from 'react';
import { financeAction } from './actions';
import { expenseMessages, categoryNames } from './messages';
import {
  categories,
  currencyScale,
  decimal,
  parseDecimal,
  splitMoney,
  formatMoney,
  inferCategory,
  type SplitMode,
} from './money';
import type { ExpenseBody, Recurring } from './models';
import type { Locale } from '@/lib/i18n/dictionaries';
export function ExpenseForm({
  homeId,
  id,
  version = 0,
  currency,
  locale,
  today,
  userId,
  members,
  initial,
  operation = 'save',
  recurring,
  shoppingList,
}: {
  homeId: string;
  id: string;
  version?: number;
  currency: string;
  locale: Locale;
  today: string;
  userId: string;
  members: { id: string; name: string }[];
  initial?: ExpenseBody;
  operation?: 'save' | 'recurring' | 'confirm';
  recurring?: Recurring;
  shoppingList?: string;
}) {
  const t = expenseMessages(locale),
    scale = currencyScale(currency);
  const [requestId] = useState(id);
  const [expectedVersion] = useState(version);
  const [title, setTitle] = useState(initial?.title ?? '');
  const [amount, setAmount] = useState(initial?.amount ? decimal(initial.amount, scale) : '');
  const [mode, setMode] = useState<SplitMode>(initial?.split_mode ?? 'equal');
  const [selected, setSelected] = useState(
    initial?.participants.map((p) => p.user_id).filter((id) => members.some((m) => m.id === id)) ??
      members.map((m) => m.id),
  );
  const [shares, setShares] = useState<Record<string, string>>(
    Object.fromEntries(
      initial?.participants.map((p) => [
        p.user_id,
        decimal(p.weight, initial.split_mode === 'percentage' ? 2 : scale),
      ]) ?? [],
    ),
  );
  const [kind, setKind] = useState(recurring?.kind ?? 'fixed');
  const [category, setCategory] = useState(initial?.category ?? '');
  const [state, action, pending] = useActionState(financeAction.bind(null, homeId, operation), {});
  const variable = operation === 'recurring' && kind === 'variable';
  let preview: { user_id: string; amount: string }[] = [];
  let invalid = false;
  try {
    preview = splitMoney(
      variable ? 10000n : parseDecimal(amount, scale),
      mode,
      selected.map((user_id) => ({
        user_id,
        weight:
          mode === 'equal'
            ? '1'
            : parseDecimal(shares[user_id] ?? '', mode === 'percentage' ? 2 : scale).toString(),
      })),
    );
    if (variable && mode === 'custom') invalid = true;
  } catch {
    invalid = true;
  }
  return (
    <form action={action} className="form">
      <fieldset disabled={pending}>
        <input type="hidden" name="id" value={requestId} />
        <input type="hidden" name="version" value={expectedVersion} />
        {shoppingList && <input type="hidden" name="shopping_list_id" value={shoppingList} />}
        <label>
          {t.concept}
          <input
            name="title"
            required
            maxLength={160}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {operation === 'recurring' && (
          <>
            <label>
              {t.kind}
              <select
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.target.value as 'fixed' | 'variable')}
              >
                <option value="fixed">{t.fixed}</option>
                <option value="variable">{t.variable}</option>
              </select>
            </label>
            <p>{t.variableHelp}</p>
          </>
        )}
        {!variable && (
          <label>
            {t.amount} ({currency})
            <input
              name="amount"
              inputMode="decimal"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <small>{t.amountLimit}</small>
          </label>
        )}
        <label>
          {t.date}
          <input
            name="date"
            type="date"
            required
            defaultValue={initial?.date ?? today}
            readOnly={operation === 'confirm'}
          />
        </label>
        <label>
          {t.payer}
          <select
            name="payer"
            defaultValue={members.some((m) => m.id === initial?.payer) ? initial?.payer : userId}
          >
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.category}
          <select name="category" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">
              {t.auto} · {categoryNames[locale][inferCategory(title)]}
            </option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {categoryNames[locale][c]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t.split}
          <select
            name="split_mode"
            value={mode}
            onChange={(e) => setMode(e.target.value as SplitMode)}
          >
            <option value="equal">{t.equal}</option>
            <option value="custom" disabled={variable}>
              {t.custom}
            </option>
            <option value="percentage">{t.percentage}</option>
          </select>
        </label>
        <fieldset>
          <legend>{t.participants}</legend>
          {members.map((m) => (
            <div key={m.id} className="stack">
              <label className="checkbox">
                <input
                  type="checkbox"
                  name="participant"
                  value={m.id}
                  checked={selected.includes(m.id)}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked ? [...selected, m.id] : selected.filter((id) => id !== m.id),
                    )
                  }
                />
                {m.name}
              </label>
              {mode !== 'equal' && selected.includes(m.id) && (
                <label>
                  {m.name} · {mode === 'percentage' ? '%' : currency}
                  <input
                    name={`share_${m.id}`}
                    inputMode="decimal"
                    required
                    value={shares[m.id] ?? ''}
                    onChange={(e) => setShares({ ...shares, [m.id]: e.target.value })}
                  />
                </label>
              )}
            </div>
          ))}
        </fieldset>
        {operation === 'recurring' ? (
          <>
            <label>
              {t.frequency}
              <select name="frequency" defaultValue={recurring?.frequency ?? 'monthly'}>
                <option value="weekly">{t.weekly}</option>
                <option value="monthly">{t.monthly}</option>
              </select>
            </label>
            <label>
              {t.every}
              <input
                name="every_n"
                type="number"
                min={1}
                max={120}
                required
                defaultValue={recurring?.every_n ?? 1}
              />
            </label>
            <label>
              {t.anchor}
              <input
                name="anchor"
                type="date"
                required
                defaultValue={recurring?.anchor_date ?? today}
              />
            </label>
            <label className="checkbox">
              <input name="active" type="checkbox" defaultChecked={recurring?.active ?? true} />
              {t.active}
            </label>
          </>
        ) : (
          <label>
            {t.receipt}
            <input
              name="receipt"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
            />
          </label>
        )}
      </fieldset>
      {!variable && (
        <section aria-live="polite">
          <h3>{t.preview}</h3>
          {invalid ? (
            <p className="notice">{t.invalid}</p>
          ) : (
            preview.map((p) => (
              <p key={p.user_id}>
                {members.find((m) => m.id === p.user_id)?.name}:{' '}
                <strong>{formatMoney(p.amount, currency, locale)}</strong>
              </p>
            ))
          )}
        </section>
      )}
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice success" role="status">
          {state.success}
        </p>
      )}
      <button
        type="submit"
        className="button"
        disabled={pending || invalid || Boolean(state.success)}
      >
        {pending ? t.saving : operation === 'confirm' ? t.confirm : t.save}
      </button>
      {state.success && version === 0 && operation !== 'confirm' && (
        <a className="text-link" href={`/homes/${homeId}/expenses`}>
          {t.newExpense}
        </a>
      )}
    </form>
  );
}
