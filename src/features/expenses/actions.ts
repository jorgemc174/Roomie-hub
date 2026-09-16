'use server';
import { receiptExtension } from './receipts';
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
    const { db } = await requireUser();
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
      const total = variable ? 10000n : parseDecimal(field(form, 'amount'), scale);
      const participants = form
        .getAll('participant')
        .map(String)
        .map((user_id) => ({
          user_id,
          weight:
            mode === 'equal'
              ? '1'
              : parseDecimal(
                  field(form, `share_${user_id}`),
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
      const file = form.get('receipt');
      let attachment: { file: File; extension: string } | undefined;
      if (file instanceof File && file.size) {
        if (file.size > 10485760) return { error: t.receiptInvalid };
        const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const ext = receiptExtension(file.type, file.size, bytes);
        if (!ext) return { error: t.receiptInvalid };
        attachment = { file, extension: ext };
      }
      if (operation === 'recurring') {
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
      if (!result.error && attachment) {
        const path = `${homeId}/${id}/${crypto.randomUUID()}.${attachment.extension}`;
        const upload = await db.storage
          .from('expense-receipts')
          .upload(path, attachment.file, { contentType: attachment.file.type, upsert: false });
        const attached = upload.error
          ? upload
          : await db.rpc('attach_expense_receipt', {
              target: homeId,
              item: id,
              object_path: path,
              media_type: attachment.file.type,
              byte_size: attachment.file.size,
            });
        if (attached.error) {
          if (!upload.error) await db.storage.from('expense-receipts').remove([path]);
          revalidatePath(`/homes/${homeId}`, 'layout');
          return { error: t.receiptFailed };
        }
      }
    } else return { error: t.invalid };
    if (result.error) throw result.error;
    revalidatePath(`/homes/${homeId}`, 'layout');
    return { success: t.saved };
  } catch (e) {
    unstable_rethrow(e);
    const err = e as { message?: string; code?: string };
    if (err.code === 'PGRST202' || err.code === '42P01') return { error: t.migration };
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
