// Development fixtures only. Business operations use real user JWTs, never the admin client.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const env = process.env;
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, opts);
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY,
  opts,
);
const accounts = [],
  homes = [];
let browser;
const rpc = async (c, name, args) => {
  const r = await c.rpc(name, args);
  if (r.error) throw new Error(`${name}: ${r.error.code} ${r.error.message}`);
  return r.data;
};
const rows = async (query) => {
  const r = await query;
  if (r.error) throw r.error;
  return r.data;
};
const pass = (s) => console.log(`PASS ${s}`);
// Let streamed refreshes finish before replacing the document or closing its context.
const visit = async (page, url) => {
  await page.waitForLoadState('networkidle');
  await page.goto(url);
  await page.waitForLoadState('networkidle');
};
try {
  const probe = await client().rpc('initialize_resources', { target: randomUUID() });
  if (probe.error?.code === 'PGRST202')
    throw new Error('Apply migration 006 after 005 before remote validation');
  const access = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (access.error)
    throw new Error(`Fixture access: ${access.error.status} ${access.error.message}`);
  for (const name of ['A', 'B', 'Outside']) {
    const email = `roomiehub-calendar-${randomUUID()}@example.com`,
      password = `Aa1!${randomBytes(18).toString('hex')}`;
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `Calendar ${name}` },
    });
    if (r.error) throw r.error;
    const u = { id: r.data.user.id, email, password, c: client() };
    accounts.push(u);
    const login = await u.c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const [a, b, outsider] = accounts;
  const h = await rpc(a.c, 'create_home', { home_name: 'QA Phase 4', home_currency: 'EUR' });
  homes.push(h);
  const inv = await rows(a.c.from('invitations').select('code').eq('home_id', h).single());
  await rpc(b.c, 'join_home', { invite_code: inv.code });
  const home = await rows(a.c.from('homes').select('*').eq('id', h).single());
  const today = await rpc(a.c, 'home_local_date', { target: h });
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = tomorrow.toISOString().slice(0, 10);
  const r = randomUUID(),
    other = randomUUID();
  for (const [id, label] of [
    [r, 'QA Washer'],
    [other, 'QA Kitchen'],
  ])
    await rpc(a.c, 'save_resource', {
      target: h,
      item: id,
      expected_version: 0,
      label,
      notes: '',
      enabled: true,
    });
  const booking = {
    target: h,
    expected_version: 0,
    resource: r,
    person: a.id,
    label: 'Concurrent',
    start_local: `${day}T18:00`,
    end_local: `${day}T19:00`,
    expected_timezone: home.timezone,
  };
  const race = await Promise.all(
    [a, b].map((u) =>
      u.c.rpc('save_reservation', { ...booking, item: randomUUID(), person: u.id }),
    ),
  );
  assert.equal(race.filter((x) => !x.error).length, 1);
  assert.equal(race.filter((x) => x.error).length, 1);
  assert.match(race.find((x) => x.error).error.message, /reservation_conflict|conflicting key/);
  const winner = race.find((x) => !x.error).data;
  assert.equal((await rows(a.c.from('reservations').select('id').eq('home_id', h))).length, 1);
  pass('two authenticated HTTP requests concurrently reserve one slot: exactly one succeeds');
  const adjacent = randomUUID();
  await rpc(b.c, 'save_reservation', {
    ...booking,
    item: adjacent,
    start_local: `${day}T19:00`,
    end_local: `${day}T20:00`,
  });
  await rpc(b.c, 'save_reservation', { ...booking, item: randomUUID(), resource: other });
  assert.ok(
    (
      await a.c.rpc('save_reservation', {
        ...booking,
        item: adjacent,
        expected_version: 1,
        start_local: `${day}T18:30`,
      })
    ).error,
  );
  await rpc(b.c, 'cancel_reservation', { target: h, item: winner, expected_version: 1 });
  await rpc(a.c, 'save_reservation', { ...booking, item: randomUUID() });
  pass('adjacent/different resources allowed; conflicting edit rejected; cancellation frees slot');
  for (const table of ['resources', 'reservations', 'activities', 'activity_members']) {
    assert.equal((await rows(outsider.c.from(table).select('*').eq('home_id', h))).length, 0);
    assert.ok((await outsider.c.from(table).insert({ home_id: h })).error);
  }
  assert.ok((await outsider.c.rpc('save_reservation', { ...booking, item: randomUUID() })).error);
  pass('four tables isolate outsider reads and reject direct writes/cross-home RPC');
  const beforeZone = await rows(
    a.c.from('reservations').select('id,starts_at,ends_at').eq('home_id', h).order('id'),
  );
  await rpc(a.c, 'update_home_timezone', { target: h, zone: 'Asia/Tokyo' });
  assert.deepEqual(
    await rows(
      a.c.from('reservations').select('id,starts_at,ends_at').eq('home_id', h).order('id'),
    ),
    beforeZone,
  );
  assert.equal(
    (await a.c.rpc('save_reservation', { ...booking, item: randomUUID() })).error?.message,
    'stale_timezone',
  );
  assert.equal(
    (
      await a.c.rpc('calendar_local_instant', {
        wall: '2027-03-28T02:30:00',
        zone: 'Europe/Madrid',
      })
    ).error?.message,
    'nonexistent_local_time',
  );
  const fold = await rpc(a.c, 'calendar_local_instant', {
    wall: '2026-10-25T02:30:00',
    zone: 'Europe/Madrid',
  });
  assert.equal(new Date(fold).toISOString(), '2026-10-25T01:30:00.000Z');
  await rpc(a.c, 'update_home_timezone', { target: h, zone: home.timezone });
  pass(
    'remote timezone change preserves instants, rejects stale forms and DST gaps, resolves repeated hour',
  );
  // Calendar fixtures use the existing module RPCs. Visiting Calendar must not generate more.
  await rpc(a.c, 'save_chore', {
    target: h,
    chore: null,
    task_name: 'QA deadline',
    task_description: '',
    weight: 2,
    enabled: true,
    kind: 'daily',
    every_n: 1,
    anchor: day,
    mode: 'automatic',
    rotation: [],
    due_days: 0,
    due_time: '20:00',
    due_timezone: home.timezone,
  });
  await rpc(a.c, 'generate_chore_instances', { target: h, from_date: day, through_date: day });
  await rpc(a.c, 'save_recurring_expense', {
    target: h,
    item: randomUUID(),
    expected_version: 0,
    body: {
      title: 'QA next rent',
      amount: '1000',
      date: day,
      payer: a.id,
      category: 'other',
      split_mode: 'equal',
      participants: [a, b].map((u) => ({ user_id: u.id, weight: '1' })),
    },
    recurrence_kind: 'variable',
    freq: 'monthly',
    n: 1,
    anchor: day,
    enabled: true,
  });
  if (env.SKIP_REMOTE_UI !== 'true') {
    browser = await chromium.launch({ headless: true });
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }),
    ]);
    const pages = await Promise.all(contexts.map((c) => c.newPage()));
    const base = env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
    for (const [i, u] of [a, b].entries()) {
      await visit(pages[i], `${base}/login`);
      await pages[i].locator('[name=email]').fill(u.email);
      await pages[i].locator('[name=password]').fill(u.password);
      await pages[i].locator('button[type=submit]').click();
      await pages[i].waitForURL('**/homes');
    }
    const [pa, pb] = pages;
    await visit(pa, `${base}/homes/${h}/organization/reservations`);
    await pa.getByText('Recursos', { exact: true }).click();
    await pa.getByText('Crear recurso', { exact: true }).click();
    let form;
    // Locate the create form by its empty required name, independent of seeded resource names.
    form = pa
      .locator('details')
      .filter({ has: pa.locator('summary').filter({ hasText: /^Crear recurso$/ }) })
      .last()
      .locator('form');
    await form.locator('[name=name]').fill('Lavadora UI');
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form.getByRole('status')).toBeVisible();
    await pa.waitForLoadState('networkidle');
    await pa.reload();
    await pa.waitForLoadState('networkidle');
    await pa.getByText('Crear reserva', { exact: true }).click();
    form = pa
      .locator('details')
      .filter({ has: pa.locator('summary').filter({ hasText: /^Crear reserva$/ }) })
      .last()
      .locator('form');
    await form.locator('[name=resource]').selectOption({ label: 'Lavadora UI' });
    await form.locator('[name=title]').fill('Colada UI');
    await form.locator('[name=start]').fill(`${day}T16:00`);
    await form.locator('[name=end]').fill(`${day}T17:00`);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(
      pa.getByRole('heading', { name: 'Lavadora UI · Colada UI', exact: true }),
    ).toBeVisible();
    let article = pa
      .locator('article')
      .filter({ has: pa.getByRole('heading', { name: 'Lavadora UI · Colada UI', exact: true }) });
    await article.getByText('Editar', { exact: true }).click();
    form = article.locator('form').filter({ has: pa.locator('[name=title]') });
    await form.locator('[name=title]').fill('Colada editada');
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(pa.getByRole('heading', { name: 'Lavadora UI · Colada editada' })).toBeVisible();
    await pa.waitForLoadState('networkidle');
    await pa.reload();
    await pa.waitForLoadState('networkidle');
    article = pa
      .locator('article')
      .filter({ has: pa.getByRole('heading', { name: 'Lavadora UI · Colada editada' }) });
    await article
      .locator('summary')
      .filter({ hasText: /^Cancelar$/ })
      .click();
    await article.locator('[name=confirm]').check();
    await article.getByRole('button', { name: 'Cancelar', exact: true }).click();
    await expect(pa.getByRole('heading', { name: 'Lavadora UI · Colada editada' })).toHaveCount(0);
    pass('browser creates resource and tomorrow reservation, edits and cancels it');
    await Promise.all(pages.map((p) => visit(p, `${base}/homes/${h}/community`)));
    await pa.getByText('Crear actividad', { exact: true }).click();
    form = pa
      .locator('form')
      .filter({ has: pa.locator('[name=title]') })
      .first();
    await form.locator('[name=title]').fill('Cena italiana');
    await form.locator('[name=location]').fill('En casa');
    await form.locator('[name=start]').fill(`${day}T21:00`);
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(pb.getByRole('heading', { name: 'Cena italiana', exact: true })).toBeVisible({
      timeout: 25000,
    });
    await pb.getByRole('button', { name: 'Apuntarme', exact: true }).click();
    await expect(
      pa
        .locator('article')
        .filter({ has: pa.getByRole('heading', { name: 'Cena italiana' }) })
        .getByText('Calendar B', { exact: true }),
    ).toBeVisible({ timeout: 25000 });
    pass('two-browser activity creation and joining propagate without reload');
    const countBefore = (await rows(a.c.from('chore_instances').select('id').eq('home_id', h)))
      .length;
    for (const p of pages) {
      await visit(p, `${base}/homes/${h}/calendar?month=${day.slice(0, 7)}&day=${day}`);
      for (const title of ['QA deadline', 'QA next rent', 'Cena italiana'])
        await expect(p.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(p.locator('.calendar-event.kind-reservations').first()).toBeVisible();
      await p.getByLabel('Actividades', { exact: true }).uncheck();
      await expect(p.getByRole('heading', { name: 'Cena italiana', exact: true })).toHaveCount(0);
      await p.getByLabel('Actividades', { exact: true }).check();
      await p.getByLabel('Solo lo mío', { exact: true }).check();
      await expect(p.getByRole('heading', { name: 'Cena italiana', exact: true })).toBeVisible();
      assert.equal(
        await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        true,
      );
    }
    assert.equal(
      (await rows(a.c.from('chore_instances').select('id').eq('home_id', h))).length,
      countBefore,
    );
    assert.equal(
      (await rows(a.c.from('recurring_expense_instances').select('id').eq('home_id', h))).length,
      0,
    );
    await mkdir('test-results/calendar-remote', { recursive: true });
    await pb.screenshot({
      path: 'test-results/calendar-remote/calendar-mobile.png',
      fullPage: true,
    });
    await pa.screenshot({
      path: 'test-results/calendar-remote/calendar-desktop.png',
      fullPage: true,
    });
    pass('four sources, category/personal filters, no generation and no overflow at 360px/desktop');
    await visit(pb, `${base}/profile`);
    await pb.getByLabel('Idioma').selectOption('en');
    await pb.getByLabel('Apariencia').selectOption('dark');
    await pb.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(pb.locator('html')).toHaveAttribute('lang', 'en');
    await expect(pb.locator('html')).toHaveAttribute('data-theme', 'dark');
    await visit(pb, `${base}/homes/${h}/calendar?month=${day.slice(0, 7)}&day=${day}`);
    await expect(pb.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
    await pb.getByLabel('Only mine', { exact: true }).check();
    assert.equal(await pb.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await pb.screenshot({
      path: 'test-results/calendar-remote/calendar-mobile-dark-en.png',
      fullPage: true,
    });
    pass('authenticated calendar English/dark preferences persist at 360px');
  } else console.log('SKIP authenticated browser and visual Realtime validation');
  if (browser) {
    await Promise.all(
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .map((p) => p.waitForLoadState('networkidle')),
    );
    await browser.close();
    browser = undefined;
  }
  await rpc(b.c, 'leave_home', { target: h });
  assert.equal((await rows(b.c.from('reservations').select('id').eq('home_id', h))).length, 0);
  pass('former member loses operational access');
} finally {
  if (browser) {
    await Promise.all(
      browser
        .contexts()
        .flatMap((c) => c.pages())
        .map((p) => p.waitForLoadState('networkidle')),
    );
    await browser.close();
  }
  let cleanupFailed = false;
  for (const id of homes) {
    const r = await admin.from('homes').delete().eq('id', id);
    if (r.error) {
      cleanupFailed = true;
      console.error('Fixture home cleanup failed', id, r.error.message);
    }
  }
  for (const u of accounts) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) {
      cleanupFailed = true;
      console.error('Fixture user cleanup failed', u.id, r.error.message);
    }
  }
  console.log('Cleanup targeted only this run’s fixtures.');
  if (cleanupFailed) process.exitCode = 1;
}
