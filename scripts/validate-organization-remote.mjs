// Explicit integration test against a development Supabase project. Creates isolated fixtures,
// uses real user JWTs for all business operations, and removes only its own fixtures in finally.
// Administrative credentials are confined to account setup/cleanup; never imported by the app.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const secret = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !secret) throw new Error('Missing development Supabase credentials');
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secret, opts);
const preflight = createClient(url, key, opts);
const accounts = [],
  homes = [];
let browser;
const today = new Date().toISOString().slice(0, 10);
const next = new Date(Date.parse(today) + 86400000).toISOString().slice(0, 10);
const suffix = randomUUID();
async function rpc(client, fn, args) {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.code} ${error.message}`);
  return data;
}
async function read(client, table, home) {
  const { data, error } = await client.from(table).select('*').eq('home_id', home);
  if (error) throw new Error(`${table}: ${error.code}`);
  return data;
}
const log = (message) => console.log(`PASS ${message}`);
try {
  // This pure function also proves the phase-2 schema has reached PostgREST.
  const { error: schemaError } = await preflight.rpc('chore_period', {
    kind: 'daily',
    n: 1,
    anchor: today,
    on_date: today,
  });
  if (schemaError && schemaError.code === 'PGRST202')
    throw new Error('Apply 202609150003_organization.sql before running remote validation');
  for (const name of ['A', 'B', 'C']) {
    const email = `roomiehub-qa-${suffix}-${name.toLowerCase()}@example.com`;
    const password = `Aa1!${randomBytes(18).toString('base64url')}`;
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `QA Roomie ${name}` },
    });
    if (error) throw new Error(`Create fixture account: ${error.code}`);
    const client = createClient(url, key, opts);
    const account = { id: data.user.id, email, password, client };
    accounts.push(account);
    const login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw new Error(`Fixture login: ${login.error.code}`);
  }
  const [a, b, c] = accounts;
  const sessionA = await a.client.auth.getSession();
  await a.client.realtime.setAuth(sessionA.data.session.access_token);
  const h = await rpc(a.client, 'create_home', {
    home_name: `QA Phase 2 ${suffix}`,
    home_currency: 'JPY',
  });
  homes.push({ id: h, owner: a });
  const invitation = (await read(a.client, 'invitations', h))[0].code;
  await rpc(b.client, 'join_home', { invite_code: invitation });
  const other = await rpc(c.client, 'create_home', { home_name: `QA Isolated ${suffix}` });
  homes.push({ id: other, owner: c });
  for (const table of [
    'chores',
    'chore_rotation_members',
    'chore_instances',
    'chore_assignment_events',
    'absences',
    'shopping_lists',
    'shopping_items',
  ])
    assert.equal((await read(c.client, table, h)).length, 0);
  log('remote schema, international currency, memberships and all seven RLS read boundaries');
  let eventResolve;
  const event = new Promise((resolve) => {
    eventResolve = resolve;
  });
  const channel = a.client
    .channel(`qa:${h}`, { config: { postgres_changes_options: { wait: true, timeout: 15000 } } })
    .on('system', {}, (payload) => console.log('Realtime system:', payload.status, payload.message))
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'shopping_lists', filter: `home_id=eq.${h}` },
      () => eventResolve(),
    );
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscribe timeout')), 15000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      }
      if (status === 'CHANNEL_ERROR') {
        clearTimeout(timer);
        reject(new Error('Realtime channel error'));
      }
    });
  });
  const list = await rpc(b.client, 'shopping_command', {
    target: h,
    operation: 'create_list',
    label: 'QA realtime list',
  });
  let eventTimer;
  await Promise.race([
    event,
    new Promise((_, reject) => {
      eventTimer = setTimeout(() => reject(new Error('Realtime event timeout')), 15000);
    }),
  ]);
  clearTimeout(eventTimer);
  await a.client.removeChannel(channel);
  log('real Supabase Realtime INSERT delivered across user sessions');
  const item = await rpc(a.client, 'shopping_command', {
    target: h,
    operation: 'add_item',
    list_id: list,
    label: 'QA milk',
  });
  await rpc(b.client, 'shopping_command', { target: h, operation: 'complete_list', list_id: list });
  assert.equal(
    (await read(a.client, 'shopping_items', h)).find((i) => i.id === item).purchased,
    true,
  );
  const denied = await c.client.rpc('shopping_command', {
    target: other,
    operation: 'add_item',
    list_id: list,
    label: 'Forbidden',
  });
  assert.ok(denied.error);
  log('real shopping completion and cross-home mutation rejection');
  const taskArgs = {
    target: h,
    chore: null,
    task_name: 'QA weighted',
    task_description: '',
    weight: 5,
    enabled: true,
    kind: 'daily',
    every_n: 1,
    anchor: today,
    mode: 'automatic',
    rotation: [],
    due_days: null,
    due_time: '20:00',
    due_timezone: 'UTC',
  };
  const automatic = await rpc(a.client, 'save_chore', taskArgs);
  const manual = await rpc(a.client, 'save_chore', {
    ...taskArgs,
    task_name: 'QA rotation',
    weight: 2,
    mode: 'manual',
    rotation: [a.id, b.id],
  });
  await rpc(a.client, 'generate_chore_instances', {
    target: h,
    from_date: today,
    through_date: next,
  });
  const again = await rpc(b.client, 'generate_chore_instances', {
    target: h,
    from_date: today,
    through_date: next,
  });
  assert.equal(again.created, 0);
  const rotation = (await read(a.client, 'chore_instances', h))
    .filter((i) => i.chore_id === manual)
    .sort((x, y) => x.period_start.localeCompare(y.period_start));
  assert.deepEqual(
    rotation.map((i) => i.assignee_id),
    [a.id, b.id],
  );
  await rpc(a.client, 'save_absence', {
    target: h,
    absence: null,
    person: b.id,
    starts: next,
    ends: next,
    remove: false,
  });
  assert.equal(
    (await read(a.client, 'chore_instances', h)).find((i) => i.id === rotation[1].id).assignee_id,
    a.id,
  );
  await rpc(b.client, 'complete_chore', { target: h, instance: rotation[0].id });
  assert.equal(
    (await read(a.client, 'chore_instances', h)).find((i) => i.id === rotation[0].id).completed_by,
    b.id,
  );
  assert.ok((await read(a.client, 'chore_instances', h)).some((i) => i.chore_id === automatic));
  log(
    'real task generation, idempotency, ordered manual rotation, absence reassignment and equal completion permissions',
  );

  if (process.env.SKIP_REMOTE_UI !== 'true') {
    browser = await chromium.launch();
    const base = process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    const ca = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const cb = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    });
    const pa = await ca.newPage(),
      pb = await cb.newPage();
    const wire = { updates: 0, inserts: 0, refreshes: 0 };
    pa.on('console', (message) => {
      if (message.text().startsWith('roomiehub-sync')) console.log(message.text());
    });
    pa.on('websocket', (ws) =>
      ws.on('framereceived', (frame) => {
        const raw = String(frame.payload);
        if (raw.includes('postgres_changes') && raw.includes('UPDATE')) wire.updates++;
        if (raw.includes('postgres_changes') && raw.includes('INSERT')) wire.inserts++;
      }),
    );
    pa.on('request', (req) => {
      if (req.url().includes('/organization')) wire.refreshes++;
    });
    for (const [page, account] of [
      [pa, a],
      [pb, b],
    ]) {
      await page.goto(`${base}/login`);
      await page.getByLabel('Correo electrónico', { exact: true }).fill(account.email);
      await page.getByLabel('Contraseña', { exact: true }).fill(account.password);
      await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
      await expect(page).toHaveURL(/\/homes$/, { timeout: 30000 });
      await page.goto(`${base}/homes/${h}/organization?view=all`);
      await expect(page.getByRole('heading', { name: 'Tareas', exact: true })).toBeVisible({
        timeout: 30000,
      });
    }
    const taskLabel = `UI task ${suffix.slice(0, 8)}`;
    const editor = pa.locator('.org-disclosure');
    await editor.locator('summary').click();
    await editor.getByLabel('Nombre', { exact: true }).fill(taskLabel);
    await editor.getByRole('button', { name: 'Guardar', exact: true }).click();
    const taskA = pa
      .locator('.task-row')
      .filter({ has: pa.getByRole('heading', { name: taskLabel, exact: true }) })
      .first();
    const taskB = pb
      .locator('.task-row')
      .filter({ has: pb.getByRole('heading', { name: taskLabel, exact: true }) })
      .first();
    await expect(taskB).toBeVisible({ timeout: 30000 });
    console.log(
      'UI instance agreement:',
      (await taskA.locator('input[name=id]').inputValue()) ===
        (await taskB.locator('input[name=id]').inputValue()),
    );
    await taskB.getByRole('button', { name: 'Marcar como hecha' }).click();
    await expect(taskB.locator('.badge')).toHaveText('Completada', { timeout: 30000 });
    try {
      await expect(taskA.locator('.badge')).toHaveText('Completada', { timeout: 30000 });
    } catch (error) {
      console.log('Realtime diagnostics:', wire);
      throw error;
    }
    log(
      'browser A creates task, browser B receives and completes it, A receives UPDATE without reload',
    );
    for (const page of [pa, pb]) await page.goto(`${base}/homes/${h}/organization?tab=shopping`);
    const listLabel = `UI shopping ${suffix.slice(0, 8)}`;
    const listEditor = pa
      .locator('details')
      .filter({ has: pa.locator('summary', { hasText: 'Crear lista' }) })
      .first();
    await listEditor.locator('summary').click();
    await listEditor.getByLabel('Nombre', { exact: true }).fill(listLabel);
    await listEditor.getByRole('button', { name: 'Crear lista', exact: true }).click();
    const listA = pa
      .locator('.shopping-list')
      .filter({ has: pa.getByRole('heading', { name: listLabel, exact: true }) });
    const listB = pb
      .locator('.shopping-list')
      .filter({ has: pb.getByRole('heading', { name: listLabel, exact: true }) });
    await expect(listB).toBeVisible({ timeout: 30000 });
    const addForm = listA
      .locator('form')
      .filter({ has: pa.getByRole('button', { name: 'Añadir producto', exact: true }) });
    for (const product of ['UI apples', 'UI bread']) {
      await addForm.getByLabel('Nombre', { exact: true }).fill(product);
      await addForm.getByRole('button', { name: 'Añadir producto', exact: true }).click();
      await expect(listB.locator('.products li').filter({ hasText: product })).toBeVisible({
        timeout: 30000,
      });
    }
    await listB
      .locator('.products li')
      .filter({ hasText: 'UI apples' })
      .getByRole('button', { name: 'Marcar comprado', exact: true })
      .click();
    await expect(listA.locator('.products li').filter({ hasText: 'UI apples' })).toHaveClass(
      'purchased',
      { timeout: 30000 },
    );
    await listB.getByRole('button', { name: 'Comprar toda la lista', exact: true }).click();
    await expect(listA.locator('.products li.purchased')).toHaveCount(2, { timeout: 30000 });
    log(
      'browser shopping creation, product toggle and transactional whole-list completion synchronize',
    );
    await mkdir('test-results/remote', { recursive: true });
    await pa.screenshot({
      path: 'test-results/remote/shopping-desktop-es-light.png',
      fullPage: true,
    });
    await pb.goto(`${base}/profile`);
    await expect(pb.getByRole('link', { name: 'Mis pisos', exact: true })).toBeVisible();
    await expect(pb.getByRole('button', { name: 'Cerrar sesión', exact: true })).toBeVisible();
    await pb.getByLabel('Idioma').selectOption('en');
    await pb.getByLabel('Apariencia').selectOption('dark');
    await pb.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(pb.locator('html')).toHaveAttribute('lang', 'en');
    await pb.goto(`${base}/homes/${h}/organization?tab=shopping`);
    await expect(pb.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(pb.getByRole('heading', { name: 'Shopping', exact: true })).toBeVisible();
    assert.ok(await pb.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
    await expect(
      pb.locator('.topbar').getByRole('button', { name: 'Sign out', exact: true }),
    ).toHaveCount(0);
    await pb.screenshot({
      path: 'test-results/remote/shopping-mobile-en-dark.png',
      fullPage: true,
    });
    log('authenticated profile navigation, Spanish/English, light/dark and mobile layout');
    await Promise.all([pa.waitForLoadState('networkidle'), pb.waitForLoadState('networkidle')]);
    await browser.close();
    browser = null;
  }
  // Admin deactivation is fixture setup only; the product still defers leave-home/debts to phase 3.
  const inactive = await admin
    .from('home_members')
    .update({ active: false, left_at: new Date().toISOString() })
    .eq('home_id', h)
    .eq('user_id', b.id);
  if (inactive.error) throw new Error(`Fixture deactivation: ${inactive.error.code}`);
  for (const table of [
    'chores',
    'chore_rotation_members',
    'chore_instances',
    'chore_assignment_events',
    'absences',
    'shopping_lists',
    'shopping_items',
  ])
    assert.equal((await read(b.client, table, h)).length, 0);
  const refused = await b.client.rpc('shopping_command', {
    target: h,
    operation: 'create_list',
    label: 'No access',
  });
  assert.ok(refused.error);
  log('former member loses all operational reads and mutations on real Supabase');
  console.log('REMOTE ORGANIZATION VALIDATION PASSED');
} finally {
  if (browser) await browser.close();
  let cleanupFailed = false;
  for (const h of homes) {
    const members = await admin
      .from('home_members')
      .update({ active: false, left_at: new Date().toISOString() })
      .eq('home_id', h.id)
      .neq('user_id', h.owner.id);
    const removed = await h.owner.client.rpc('delete_home', { target: h.id });
    if (members.error || removed.error) {
      cleanupFailed = true;
      console.error(`Fixture cleanup failed for home ${h.id}`);
    }
  }
  if (!cleanupFailed)
    for (const account of accounts) {
      await account.client.removeAllChannels();
      await account.client.auth.signOut({ scope: 'local' });
      const result = await admin.auth.admin.deleteUser(account.id);
      if (result.error) {
        cleanupFailed = true;
        console.error(`Fixture account cleanup failed: ${account.id}`);
      }
    }
  if (cleanupFailed) process.exitCode = 1;
  else console.log('Removed only the accounts and homes created by this validation run.');
}
