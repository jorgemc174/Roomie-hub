'use server';
import { receiptFile } from './receipts';
import { RECEIPT_BUCKET, allowedReceiptExtension, receiptStagingFolder } from './receipt-limits';
import { revalidatePath } from 'next/cache';
import { redirect, unstable_rethrow } from 'next/navigation';
import { getHome, requireUser } from '@/lib/data';
import { i18n } from '@/lib/i18n/server';
import type { ActionState } from '@/app/actions';
import { expenseMessages } from './messages';
import {
  categories,
  currencyScale,
  parseDecimal,
  splitMoney,
  inferCategory,
  formatMoney,
  type SplitMode,
  type Category,
} from './money';
import type { ExpenseBody } from './models';
import { validDate } from '@/features/organization/logic';
import { checkExpense, fillMessage, formatPercent, shareValue } from './validation';
const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const uuid = (v: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
export async function financeAction(
  homeId: string,
  operation: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const { locale } = await i18n(),
    t = expenseMessages(locale);
  try {
    const { db, user } = await requireUser();
    const home = await getHome(homeId);
    const scale = currencyScale(home.currency);
    const id = field(form, 'id'),
      version = Number(field(form, 'version') || '0');
    if (operation === 'leave') {
      if (field(form, 'confirm') !== 'on') return { error: t.invalid };
      const result = await db.rpc('leave_home', { target: homeId });
      if (result.error) {
        if (result.error.message.startsWith('outstanding_balance:'))
          return {
            error: `${t.leaveDebt} ${formatMoney(result.error.message.split(':')[1], home.currency, locale)}`,
          };
        throw result.error;
      }
      revalidatePath('/homes');
      redirect('/homes');
    }
    if (operation === 'generate') {
      const r = await db.rpc('generate_recurring_expenses', { target: homeId });
      if (r.error) throw r.error;
      revalidatePath(`/homes/${homeId}`, 'layout');
      return { success: r.data.more ? t.more : t.saved };
    }
    if (!uuid(id) || !Number.isInteger(version) || version < 0) return { error: t.invalid };
    let result: { error: { message: string; code?: string } | null };
    if (operation === 'payment') {
      const amount = parseDecimal(field(form, 'amount'), scale);
      const sender = field(form, 'sender'),
        recipient = field(form, 'recipient'),
        date = field(form, 'date');
      if (
        !uuid(sender) ||
        !uuid(recipient) ||
        sender === recipient ||
        !validDate(date) ||
        amount <= 0n
      )
        return { error: t.invalid };
      result = await db.rpc('record_settlement', {
        target: homeId,
        item: id,
        sender,
        recipient,
        total: amount.toString(),
        on_date: date,
      });
    } else if (operation === 'delete_recurring') {
      if (field(form, 'confirm') !== 'on') return { error: t.invalid };
      result = await db.rpc('delete_recurring_expense', {
        target: homeId,
        item: id,
        expected_version: version,
      });
    } else if (operation === 'delete') {
      if (field(form, 'confirm') !== 'on') return { error: t.invalid };
      result = await db.rpc('delete_expense', {
        target: homeId,
        item: id,
        expected_version: version,
      });
    } else if (['save', 'recurring', 'confirm'].includes(operation)) {
      const mode = field(form, 'split_mode') as SplitMode;
      const variable = operation === 'recurring' && field(form, 'kind') === 'variable';
      const selected = form.getAll('participant').map(String);
      // Same specific messages as the form, in case a request bypasses the client checks.
      const issues = checkExpense({
        title: field(form, 'title'),
        amount: field(form, 'amount'),
        variable,
        mode: ['custom', 'percentage'].includes(mode) ? mode : 'equal',
        participants: selected,
        shares: Object.fromEntries(selected.map((id) => [id, field(form, `share_${id}`)])),
        scale,
      });
      if (issues.title) return { error: t.conceptRequired };
      if (issues.amount === 'positive') return { error: t.amountPositive };
      if (issues.amount) return { error: fillMessage(t.amountFormat, { decimals: String(scale) }) };
      if (issues.participants) return { error: t.participantsRequired };
      if (issues.sum && issues.sum.sum !== issues.sum.target) {
        const { sum, target } = issues.sum;
        const money = (n: bigint) => formatMoney(n, home.currency, locale);
        return {
          error:
            issues.sum.mode === 'percentage'
              ? fillMessage(t.percentInvalid, { sum: formatPercent(sum, locale) })
              : fillMessage(sum < target ? t.splitShort : t.splitOver, {
                  sum: money(sum),
                  total: money(target),
                  diff: money(sum < target ? target - sum : sum - target),
                }),
        };
      }
      const total = variable ? 10000n : parseDecimal(field(form, 'amount'), scale);
      const participants = selected.map((user_id) => ({
        user_id,
        weight:
          mode === 'equal'
            ? '1'
            : parseDecimal(
                shareValue(field(form, `share_${user_id}`)),
                mode === 'percentage' ? 2 : scale,
              ).toString(),
      }));
      const date = field(form, 'date'),
        payer = field(form, 'payer'),
        title = field(form, 'title'),
        category = field(form, 'category') || inferCategory(title);
      if (
        !['equal', 'custom', 'percentage'].includes(mode) ||
        participants.some((p) => !uuid(p.user_id)) ||
        !uuid(payer) ||
        !validDate(date) ||
        !title ||
        title.length > 160 ||
        !categories.includes(category as Category) ||
        (variable && mode === 'custom')
      )
        return { error: t.invalid };
      splitMoney(total, mode, participants);
      const body: ExpenseBody = {
        title,
        amount: total.toString(),
        date,
        payer,
        category: category as Category,
        split_mode: mode,
        participants,
      };
      const list = field(form, 'shopping_list_id');
      if (list) {
        if (!uuid(list)) return { error: t.invalid };
        body.shopping_list_id = list;
      }
      const stagingPath = field(form, 'receipt_path');
      if (form.has('receipt') || (stagingPath && operation === 'recurring'))
        return { error: t.receiptInvalid };
      if (stagingPath) {
        const folder = receiptStagingFolder(homeId, user.id);
        if (!stagingPath.startsWith(folder)) return { error: t.receiptInvalid };
        const [nonce, extension, ...rest] = stagingPath.slice(folder.length).split('.');
        if (!uuid(nonce) || !extension || rest.length) return { error: t.receiptInvalid };

        const storage = db.storage.from(RECEIPT_BUCKET);
        const info = await storage.info(stagingPath);
        const type = info.data?.contentType;
        const size = info.data?.size;
        if (!type || size === undefined || allowedReceiptExtension(type, size) !== extension)
          return { error: t.receiptInvalid };
        const downloaded = await storage.download(stagingPath);
        const file = downloaded.data;
        if (!file || file.size !== size) return { error: t.receiptInvalid };
        const bytes = new Uint8Array(
          await (type === 'application/pdf' ? file : file.slice(0, 16)).arrayBuffer(),
        );
        const checked = await receiptFile(type, size, bytes);
        if (!checked) return { error: t.receiptInvalid };

        // Keep the original upload private. Only validated bytes reach the final path.
        const path = `${homeId}/${id}/${user.id}/${crypto.randomUUID()}.${checked.extension}`;
        const clean = checked.bytes ? new Blob([checked.bytes], { type }) : file;
        const upload = await storage.upload(path, clean, { contentType: type, upsert: false });
        if (upload.error) return { error: t.receiptFailed };
        result = await db.rpc('save_expense_with_receipt', {
          target: homeId,
          item: id,
          expected_version: version,
          body,
          object_path: path,
          confirm_occurrence: operation === 'confirm',
        });
        // Storage RLS protects a committed attachment if the RPC response was lost.
        if (result.error) await storage.remove([path]);
      } else if (operation === 'recurring') {
        const freq = field(form, 'frequency'),
          n = freq === 'weekly' ? 1 : Number(field(form, 'every_n')),
          anchor = field(form, 'anchor');
        if (
          !validDate(anchor) ||
          !['weekly', 'monthly'].includes(freq) ||
          !Number.isInteger(n) ||
          n < 1 ||
          n > 120
        )
          return { error: t.invalid };
        result = await db.rpc('save_recurring_expense', {
          target: homeId,
          item: id,
          expected_version: version,
          body,
          recurrence_kind: field(form, 'kind'),
          freq,
          n,
          anchor,
          enabled: field(form, 'active') === 'on',
        });
      } else if (operation === 'confirm')
        result = await db.rpc('confirm_recurring_expense', { target: homeId, item: id, body });
      else
        result = await db.rpc('save_expense', {
          target: homeId,
          item: id,
          expected_version: version,
          body,
        });
    } else return { error: t.invalid };
    if (result.error) throw result.error;
    revalidatePath(`/homes/${homeId}`, 'layout');
    return { success: t.saved };
  } catch (e) {
    unstable_rethrow(e);
    const err = e as { message?: string; code?: string };
    if (err.code === 'PGRST202' || err.code === '42P01') return { error: t.migration };
    if (err.message === 'expense_has_settlement') return { error: t.settledExpense };
    if (err.message === 'invalid_receipt') return { error: t.receiptInvalid };
    if (err.message?.includes('idempotency_conflict')) return { error: t.idempotency };
    if (err.message?.includes('stale_version')) return { error: t.stale };
    if (err.message?.includes('list_')) return { error: t.listIncomplete };
    if (err.message?.includes('anchor_before_history')) return { error: t.scheduleHistory };
    if (err.message?.includes('former_payment')) return { error: t.formerPayment };
    if (
      err.message?.startsWith('invalid_') ||
      err.code === '23514' ||
      err.code === '22003' ||
      err.code === '22P02'
    )
      return { error: t.invalid };
    return { error: t.error };
  }
}
