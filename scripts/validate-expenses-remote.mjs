// Development only: real Auth, PostgREST, RLS, Storage and optional two-browser Realtime.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
  key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !secret) throw new Error('Missing development Supabase configuration');
const options = { auth: { persistSession: false, autoRefreshToken: false } },
  admin = createClient(url, secret, options),
  publicClient = createClient(url, key, options);
const accounts = [],
  homes = [],
  objects = [];
let browser;
const rpc = async (c, fn, args) => {
  const r = await c.rpc(fn, args);
  if (r.error) throw new Error(`${fn}: ${r.error.code} ${r.error.message}`);
  return r.data;
};
const check = (message) => console.log(`PASS ${message}`);
try {
  const probe = await publicClient.rpc('expense_balances', { target: randomUUID() });
  if (probe.error?.code === 'PGRST202')
    throw new Error('Apply 202609150005_expenses.sql before remote validation');
  const access = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (access.error)
    throw new Error(
      `Administrative fixture access: status=${access.error.status} ${access.error.message}`,
    );
  for (const name of ['A', 'B', 'C']) {
    const email = `roomiehub-finance-${randomUUID()}@example.com`,
      password = `Aa1!${randomBytes(18).toString('hex')}`;
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Finance ${name}` },
    });
    if (r.error) throw r.error;
    const c = createClient(url, key, options),
      account = { id: r.data.user.id, email, password, c };
    accounts.push(account);
    const login = await c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const [a, b, c] = accounts;
  const h = await rpc(a.c, 'create_home', { home_name: 'QA Phase 3', home_currency: 'EUR' });
  homes.push({ id: h, owner: a });
  const invitation = await a.c.from('invitations').select('code').eq('home_id', h).single();
  if (invitation.error) throw invitation.error;
  await rpc(b.c, 'join_home', { invite_code: invitation.data.code });
  const today = await rpc(a.c, 'home_local_date', { target: h });
  const body = {
    title: 'QA shared dinner',
    amount: '3000',
    date: today,
    payer: a.id,
    category: 'food',
    split_mode: 'equal',
    participants: [a, b].map((p) => ({ user_id: p.id, weight: '1' })),
  };
  const id = randomUUID();
  await Promise.all([
    rpc(a.c, 'save_expense', { target: h, item: id, expected_version: 0, body }),
    rpc(b.c, 'save_expense', { target: h, item: id, expected_version: 0, body }),
  ]);
  assert.equal(
    (await rpc(a.c, 'expense_balances', { target: h })).find((x) => x.user_id === b.id).balance,
    '-1500',
  );
  assert.ok((await b.c.rpc('leave_home', { target: h })).error);
  const paid = randomUUID();
  await Promise.all([
    rpc(a.c, 'record_settlement', {
      target: h,
      item: paid,
      sender: b.id,
      recipient: a.id,
      total: '1500',
      on_date: today,
    }),
    rpc(b.c, 'record_settlement', {
      target: h,
      item: paid,
      sender: b.id,
      recipient: a.id,
      total: '1500',
      on_date: today,
    }),
  ]);
  assert.ok((await rpc(a.c, 'expense_balances', { target: h })).every((x) => x.balance === '0'));
  check('30 EUR split, 15 EUR payment, zero balances and concurrent retry idempotency');
  for (const [mode, total, weights] of [
    ['equal', '1001', ['1', '1']],
    ['custom', '1000', ['700', '300']],
    ['percentage', '1001', ['5000', '5000']],
  ]) {
    const item = randomUUID(),
      p = {
        ...body,
        amount: total,
        split_mode: mode,
        participants: [a, b].map((u, i) => ({ user_id: u.id, weight: weights[i] })),
      };
    await rpc(a.c, 'save_expense', { target: h, item, expected_version: 0, body: p });
    const rows = await a.c.from('expense_splits').select('amount').eq('expense_id', item);
    assert.equal(
      rows.data.reduce((s, x) => s + BigInt(x.amount), 0n),
      BigInt(total),
    );
  }
  const edits = await Promise.all([
    a.c.rpc('save_expense', {
      target: h,
      item: id,
      expected_version: 1,
      body: { ...body, title: 'Edited A' },
    }),
    b.c.rpc('save_expense', {
      target: h,
      item: id,
      expected_version: 1,
      body: { ...body, title: 'Edited B' },
    }),
  ]);
  assert.equal(edits.filter((r) => r.error).length, 1);
  check('custom/percentage rounding and optimistic concurrent edits');
  const list = await rpc(a.c, 'shopping_command', {
    target: h,
    operation: 'create_list',
    label: 'QA groceries',
  });
  await rpc(a.c, 'shopping_command', {
    target: h,
    operation: 'add_item',
    list_id: list,
    label: 'Bread',
  });
  await rpc(a.c, 'shopping_command', { target: h, operation: 'complete_list', list_id: list });
  const conversions = await Promise.all(
    [a, b].map((u) =>
      u.c.rpc('save_expense', {
        target: h,
        item: randomUUID(),
        expected_version: 0,
        body: { ...body, shopping_list_id: list },
      }),
    ),
  );
  assert.equal(conversions.filter((r) => r.error).length, 1);
  check('concurrent shopping conversion creates one linked expense');
  for (const kind of ['fixed', 'variable'])
    await rpc(a.c, 'save_recurring_expense', {
      target: h,
      item: randomUUID(),
      expected_version: 0,
      body,
      recurrence_kind: kind,
      freq: 'monthly',
      n: 1,
      anchor: today,
      enabled: true,
    });
  await Promise.all([a, b].map((u) => rpc(u.c, 'generate_recurring_expenses', { target: h })));
  const pending = await a.c
    .from('recurring_expense_instances')
    .select('id')
    .eq('home_id', h)
    .eq('status', 'pending')
    .single();
  if (pending.error) throw pending.error;
  const confirmed = await Promise.all(
    [a, b].map((u) =>
      rpc(u.c, 'confirm_recurring_expense', {
        target: h,
        item: pending.data.id,
        body: { ...body, amount: '4001' },
      }),
    ),
  );
  assert.equal(confirmed[0], confirmed[1]);
  check('fixed/variable due periods and concurrent confirmation');
  for (const table of [
    'expenses',
    'expense_splits',
    'expense_events',
    'settlements',
    'recurring_expenses',
    'recurring_expense_instances',
    'expense_attachments',
    'shopping_list_expense_links',
  ]) {
    const r = await c.c.from(table).select('*').eq('home_id', h);
    assert.equal(r.error, null);
    assert.equal(r.data.length, 0);
  }
  assert.ok((await c.c.rpc('expense_balances', { target: h })).error);
  assert.ok(
    (await c.c.rpc('save_expense', { target: h, item: randomUUID(), expected_version: 0, body }))
      .error,
  );
  const path = `${h}/${id}/${randomUUID()}.pdf`,
    bytes = Buffer.from('%PDF-1.4\n% RoomieHub access test\n%%EOF');
  const uploaded = await a.c.storage
    .from('expense-receipts')
    .upload(path, bytes, { contentType: 'application/pdf' });
  if (uploaded.error) throw uploaded.error;
  objects.push(path);
  await rpc(a.c, 'attach_expense_receipt', {
    target: h,
    item: id,
    object_path: path,
    media_type: 'application/pdf',
    byte_size: bytes.length,
  });
  assert.ok((await c.c.storage.from('expense-receipts').download(path)).error);
  assert.equal((await b.c.storage.from('expense-receipts').download(path)).error, null);
  check('eight RLS tables, cross-home RPC and private receipt');
  if (process.env.SKIP_REMOTE_UI !== 'true') {
    browser = await chromium.launch({ headless: true });
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }),
    ]);
    const pages = await Promise.all(contexts.map((x) => x.newPage()));
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    for (const [i, u] of [a, b].entries()) {
      const page = pages[i];
      await page.goto(`${base}/login`);
      await page.locator('input[name=email]').fill(u.email);
      await page.locator('input[name=password]').fill(u.password);
      await page.locator('button[type=submit]').click();
      await page.waitForURL('**/homes');
      await page.goto(`${base}/homes/${h}/expenses`);
      await expect(page.getByRole('heading', { name: 'Gastos', exact: true })).toBeVisible();
    }
    const [pa, pb] = pages;
    const form = pa.locator('form').first();
    await form.locator('[name=title]').fill('UI realtime expense');
    await form.locator('[name=amount]').fill('10,01');
    await expect(form.getByRole('button', { name: 'Guardar', exact: true })).toBeEnabled();
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(pb.getByRole('heading', { name: 'UI realtime expense', exact: true })).toBeVisible(
      { timeout: 20000 },
    );
    for (const page of pages)
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    check('authenticated desktop/mobile creation and second-browser Realtime without reload');
  }
  // Settle derived suggestions, then B can leave; its history is retained and access ends.
  const balances = await rpc(a.c, 'expense_balances', { target: h }),
    debtors = balances.filter((x) => BigInt(x.balance) < 0n),
    creditors = balances.filter((x) => BigInt(x.balance) > 0n);
  for (const d of debtors)
    for (const cr of creditors) {
      const n = -BigInt(d.balance) < BigInt(cr.balance) ? -BigInt(d.balance) : BigInt(cr.balance);
      if (n > 0n) {
        await rpc(a.c, 'record_settlement', {
          target: h,
          item: randomUUID(),
          sender: d.user_id,
          recipient: cr.user_id,
          total: n.toString(),
          on_date: today,
        });
        d.balance = (BigInt(d.balance) + n).toString();
        cr.balance = (BigInt(cr.balance) - n).toString();
      }
    }
  await rpc(b.c, 'leave_home', { target: h });
  assert.equal((await b.c.from('expenses').select('id').eq('home_id', h)).data.length, 0);
  check('settled member leaves and loses expense access');
} finally {
  if (browser) await browser.close();
  if (objects.length) {
    const r = await admin.storage.from('expense-receipts').remove(objects);
    if (r.error) console.error('Receipt cleanup failed:', r.error.message);
  }
  for (const h of homes) {
    try {
      const b = await rpc(h.owner.c, 'expense_balances', { target: h.id });
      for (const d of b.filter((x) => BigInt(x.balance) < 0n))
        for (const c of b.filter((x) => BigInt(x.balance) > 0n)) {
          const n = -BigInt(d.balance) < BigInt(c.balance) ? -BigInt(d.balance) : BigInt(c.balance);
          if (n > 0n) {
            await rpc(h.owner.c, 'record_settlement', {
              target: h.id,
              item: randomUUID(),
              sender: d.user_id,
              recipient: c.user_id,
              total: n.toString(),
              on_date: new Date().toISOString().slice(0, 10),
            });
            d.balance = (BigInt(d.balance) + n).toString();
            c.balance = (BigInt(c.balance) - n).toString();
          }
        }
      const r = await admin.from('homes').delete().eq('id', h.id);
      if (r.error) throw r.error;
    } catch (e) {
      console.error('Fixture home cleanup failed:', e.message);
    }
  }
  for (const u of accounts) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) console.error('Fixture account cleanup failed:', r.error.message);
  }
  console.log('Cleanup attempted only for fixtures created by this run.');
}
