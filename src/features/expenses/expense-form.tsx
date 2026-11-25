'use client';
import { useRetainedForm } from '@/components/ui/use-retained-form';
import { FormFeedback } from '@/components/ui/form-feedback';
import { LoaderCircle } from 'lucide-react';
import { useActionState, useRef, useState, type FormEvent } from 'react';
import { financeAction } from './actions';
import { browserClient } from '@/lib/supabase/browser';
import {
  allowedReceiptExtension,
  RECEIPT_ACCEPT,
  RECEIPT_BUCKET,
  receiptStagingFolder,
} from './receipt-limits';
import type { ActionState } from '@/app/actions';
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
import {
  checkExpense,
  fillMessage,
  formatPercent,
  hasFieldIssues,
  limitDecimals,
  shareValue,
  splitMismatch,
} from './validation';
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
  const receipt = useRef<HTMLInputElement>(null);
  const [receiptError, setReceiptError] = useState(false);
  const [state, action, pending] = useActionState(async (previous: ActionState, form: FormData) => {
    const file = receipt.current?.files?.[0];
    if (!file) return financeAction(homeId, operation, previous, form);
    const extension = allowedReceiptExtension(file.type, file.size);
    if (!extension) return { error: t.receiptInvalid };
    const path = `${receiptStagingFolder(homeId, userId)}${crypto.randomUUID()}.${extension}`;
    const storage = browserClient().storage.from(RECEIPT_BUCKET);
    const uploaded = await storage.upload(path, file, { contentType: file.type, upsert: false });
    if (uploaded.error) return { error: t.receiptFailed };
    form.set('receipt_path', path);
    try {
      return await financeAction(homeId, operation, previous, form);
    } finally {
      await storage.remove([path]);
    }
  }, {});
  const [attempted, setAttempted] = useState(false);
  const variable = operation === 'recurring' && kind === 'variable';
  const shareScale = mode === 'percentage' ? 2 : scale;
  const issues = checkExpense({
    title,
    amount,
    variable,
    mode,
    participants: selected,
    shares,
    scale,
  });
  const fieldIssues = hasFieldIssues(issues);
  // A wrong split keeps the save button disabled until the figures add up (PA 2357/2358/2362).
  const blocked = splitMismatch(issues) || (variable && mode === 'custom');
  let preview: { user_id: string; amount: string }[] = [];
  let invalid = fieldIssues || blocked;
  if (!invalid) {
    try {
      preview = splitMoney(
        variable ? 10000n : parseDecimal(amount, scale),
        mode,
        selected.map((user_id) => ({
          user_id,
          weight:
            mode === 'equal'
              ? '1'
              : parseDecimal(shareValue(shares[user_id]), shareScale).toString(),
        })),
      );
    } catch {
      invalid = true;
    }
  }
  const money = (minor: bigint) => formatMoney(minor, currency, locale);
  const sum = issues.sum;
  const showTitle = attempted && issues.title;
  const showAmount = (attempted || amount.trim() !== '') && issues.amount;
  const retainForm = useRetainedForm(state.error, pending);
  function submit(event: FormEvent<HTMLFormElement>) {
    // Client-side block: no request reaches the server while a field is invalid (PA 2337/2339).
    if (fieldIssues || blocked) {
      event.preventDefault();
      setAttempted(true);
      return;
    }
    const file = receipt.current?.files?.[0];
    if (file && !allowedReceiptExtension(file.type, file.size)) {
      event.preventDefault();
      setReceiptError(true);
      return;
    }
    retainForm(event);
  }
  return (
    <form
      onSubmit={submit}
      onInvalidCapture={() => setAttempted(true)}
      action={action}
      className="form"
    >
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
            aria-invalid={showTitle ? true : undefined}
            aria-describedby={showTitle ? `${requestId}-title-error` : undefined}
            onChange={(e) => setTitle(e.target.value)}
          />
          {showTitle && (
            <small id={`${requestId}-title-error`} className="field-error" role="alert">
              {t.conceptRequired}
            </small>
          )}
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
              aria-invalid={showAmount ? true : undefined}
              aria-describedby={showAmount ? `${requestId}-amount-error` : undefined}
              onChange={(e) => setAmount(limitDecimals(e.target.value, scale))}
            />
            {showAmount && (
              <small id={`${requestId}-amount-error`} className="field-error" role="alert">
                {issues.amount === 'positive'
                  ? t.amountPositive
                  : fillMessage(t.amountFormat, { decimals: String(scale) })}
              </small>
            )}
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
                    placeholder={decimal(0n, shareScale)}
                    value={shares[m.id] ?? ''}
                    aria-invalid={blocked ? true : undefined}
                    onChange={(e) =>
                      setShares({ ...shares, [m.id]: limitDecimals(e.target.value, shareScale) })
                    }
                  />
                </label>
              )}
            </div>
          ))}
          {issues.participants && (
            <p className="notice error" role="alert">
              {t.participantsRequired}
            </p>
          )}
          {mode !== 'equal' && issues.shares && (
            <p className="notice error" role="alert">
              {fillMessage(t.sharesFormat, { decimals: String(shareScale) })}
            </p>
          )}
          {sum && (
            <div className="split-sum" aria-live="polite">
              <p>
                {sum.mode === 'custom'
                  ? fillMessage(t.splitSum, { sum: money(sum.sum), total: money(sum.target) })
                  : fillMessage(t.percentSum, { sum: formatPercent(sum.sum, locale) })}
              </p>
              {sum.sum === sum.target ? (
                <p className="notice success">
                  {sum.mode === 'custom' ? t.splitBalanced : t.percentBalanced}
                </p>
              ) : (
                <p className="notice error" role="alert">
                  {sum.mode === 'percentage' ? (
                    <Highlighted
                      text={t.percentInvalid}
                      name="sum"
                      value={formatPercent(sum.sum, locale)}
                    />
                  ) : (
                    <Highlighted
                      text={fillMessage(sum.sum < sum.target ? t.splitShort : t.splitOver, {
                        sum: money(sum.sum),
                        total: money(sum.target),
                      })}
                      name="diff"
                      value={money(
                        sum.sum < sum.target ? sum.target - sum.sum : sum.sum - sum.target,
                      )}
                    />
                  )}
                </p>
              )}
            </div>
          )}
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
              ref={receipt}
              type="file"
              accept={RECEIPT_ACCEPT}
              aria-invalid={receiptError || undefined}
              aria-describedby={receiptError ? `${requestId}-receipt-error` : undefined}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                setReceiptError(Boolean(file && !allowedReceiptExtension(file.type, file.size)));
              }}
            />
            {receiptError && (
              <small id={`${requestId}-receipt-error`} className="field-error" role="alert">
                {t.receiptInvalid}
              </small>
            )}
          </label>
        )}
      </fieldset>
      {!variable && (
        <section aria-live="polite">
          <h3>{t.preview}</h3>
          {invalid ? (
            <p className="notice">
              {fieldIssues || !amount.trim() ? t.previewHint : blocked ? t.splitBlocked : t.invalid}
            </p>
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
      <FormFeedback
        error={receiptError ? undefined : state.error}
        success={state.success}
        pending={pending}
      />
      <button
        type="submit"
        className="button"
        disabled={pending || blocked || Boolean(state.success)}
      >
        {pending && <LoaderCircle className="ui-spinner" size={18} aria-hidden="true" />}
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

/** Renders a message with one value highlighted, e.g. the split difference (PA 2357/2358). */
function Highlighted({ text, name, value }: { text: string; name: string; value: string }) {
  const [before, after = ''] = text.split(`{${name}}`);
  return (
    <>
      {before}
      <strong className="split-diff">{value}</strong>
      {after}
    </>
  );
}
