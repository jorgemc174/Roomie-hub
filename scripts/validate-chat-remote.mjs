// Real development accounts and browser sessions. Privileged client only creates/removes fixtures.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const env = process.env,
  options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, options);
const client = () =>
  createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const accounts = [],
  homes = [],
  files = [];
let browser;
let pages = [];
const result = async (q) => {
  const r = await q;
  if (r.error) throw new Error(`${r.error.code ?? ''}: ${r.error.message}`);
  return r.data;
};
const rpc = (c, name, args) => result(c.rpc(name, args));
const base = env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
const pass = (label) => console.log(`PASS ${label}`);
try {
  for (const name of ['Ana', 'Bob', 'Cara']) {
    const email = `roomiehub-chat-${randomUUID()}@example.com`,
      password = `Aa1!${randomBytes(18).toString('hex')}`;
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `QA ${name}` },
    });
    if (r.error) throw r.error;
    const a = { id: r.data.user.id, email, password, c: client() };
    accounts.push(a);
    const login = await a.c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const [a, b, c] = accounts;
  const h = await rpc(a.c, 'create_home', { home_name: 'QA Phase6 chat', home_currency: 'EUR' });
  homes.push(h);
  const invitation = await result(a.c.from('invitations').select('code').eq('home_id', h).single());
  await rpc(b.c, 'join_home', { invite_code: invitation.code });
  const other = await rpc(b.c, 'create_home', {
    home_name: 'QA Phase6 separate home',
    home_currency: 'EUR',
  });
  homes.push(other);
  const invite2 = await result(
    b.c.from('invitations').select('code').eq('home_id', other).single(),
  );
  await rpc(c.c, 'join_home', { invite_code: invite2.code });
  assert.ok((await c.c.rpc('chat_page', { target: h })).error);
  assert.ok((await a.c.rpc('chat_page', { target: other })).error);
  pass('three users, two homes, RPC isolation');
  browser = await chromium.launch({ headless: true });
  const contexts = await Promise.all([
    browser.newContext(),
    browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }),
    browser.newContext(),
  ]);
  pages = await Promise.all(contexts.map((x) => x.newPage()));
  const errors = [];
  for (const p of pages) p.on('pageerror', (e) => errors.push(e.message));
  for (const [index, u] of accounts.entries()) {
    const p = pages[index];
    await p.goto(`${base}/login`);
    await p.locator('[name=email]').fill(u.email);
    await p.locator('[name=password]').fill(u.password);
    await p
      .locator('form')
      .filter({ has: p.locator('[name=password]') })
      .locator('button[type=submit]')
      .click();
    await p.waitForURL('**/homes', { timeout: 60000 });
  }
  const [pa, pb] = pages;
  await Promise.all([pa.goto(`${base}/homes/${h}/chat`), pb.goto(`${base}/homes/${h}/chat`)]);
  await expect(pa.getByRole('heading', { name: 'Chat del piso' })).toBeVisible();
  await expect(pb.getByRole('heading', { name: 'Chat del piso' })).toBeVisible();
  const text = `QA message ${randomUUID()} 👋\nhttps://example.com`;
  await pa.getByLabel('Mensaje', { exact: true }).fill(text);
  await pa.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(pb.locator('.chat-text').filter({ hasText: text })).toBeVisible({ timeout: 20000 });
  const m = (await result(a.c.from('chat_messages').select('*').eq('home_id', h))).find(
    (x) => x.body.replace(/\r\n/g, '\n') === text,
  );
  assert.ok(m);
  const articleA = pa.locator(`[data-message-id="${m.id}"]`),
    articleB = pb.locator(`[data-message-id="${m.id}"]`);
  await articleB.getByRole('button', { name: 'Reaccionar 👍', exact: true }).click();
  await expect(articleA.getByRole('button', { name: 'Reaccionar 👍', exact: true })).toContainText(
    '1',
    { timeout: 15000 },
  );
  assert.equal(await articleB.getByRole('button', { name: 'Editar', exact: true }).count(), 0);
  pass('two browser sessions: live messages, reaction and edit ownership');
  await articleB.getByRole('button', { name: 'Responder', exact: true }).click();
  await pb.getByLabel('Mensaje', { exact: true }).fill('QA reply');
  await pb.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(pa.locator('.chat-text').filter({ hasText: 'QA reply' })).toBeVisible({
    timeout: 15000,
  });
  await articleA.getByRole('button', { name: 'Editar', exact: true }).click();
  await pa.getByLabel('Mensaje', { exact: true }).fill('QA edited message');
  await pa.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(pb.locator('blockquote')).toContainText('QA edited message', { timeout: 15000 });
  pass('reply remains a reference through edits');
  await pa.getByLabel('Mensaje', { exact: true }).fill('QA attachment');
  await pa
    .locator('input[type=file]')
    .setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Private safe text'),
    });
  await pa.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(pb.getByText('QA attachment', { exact: true })).toBeVisible({ timeout: 20000 });
  const attachments = await result(a.c.from('chat_attachments').select('*').eq('home_id', h));
  assert.equal(attachments.length, 1);
  files.push(...attachments.map((x) => x.path));
  const attachment = attachments[0],
    fileUrl = `${base}/homes/${h}/chat/file/${attachment.id}`;
  assert.equal((await contexts[0].request.get(fileUrl)).status(), 200);
  assert.equal((await contexts[1].request.get(fileUrl)).status(), 200);
  assert.equal((await contexts[2].request.get(fileUrl)).status(), 404);
  pass('private attachment delivered only to active members');
  await pb.goto(`${base}/notifications`);
  await expect(pb.getByRole('heading', { name: 'Notificaciones', exact: true })).toBeVisible();
  const notices = await result(b.c.from('notifications').select('*').eq('home_id', h));
  assert.ok(notices.length >= 2);
  assert.ok(notices.every((n) => n.user_id === b.id));
  await pb.getByRole('button', { name: 'Marcar todas como leídas' }).click();
  await expect
    .poll(async () => {
      const rows = await result(b.c.from('notifications').select('id').is('read_at', null));
      return rows.length;
    })
    .toBe(0);
  pass('canonical inbox, own RLS and mark-all from browser');
  await pb.goto(`${base}/notifications/preferences`);
  await expect(pb.getByRole('heading', { name: 'Preferencias de notificaciones' })).toBeVisible();
  const chatPrefs = pb
    .locator('section')
    .filter({ has: pb.getByRole('heading', { name: 'Chat', exact: true }) });
  await chatPrefs.getByLabel('En la app', { exact: true }).uncheck();
  await chatPrefs.getByRole('button', { name: 'Guardar', exact: true }).click();
  await expect(chatPrefs.getByText('Preferencias guardadas.')).toBeVisible();
  const muted = randomUUID();
  await rpc(a.c, 'send_chat_message', { target: h, item: muted, message_body: 'Muted notice' });
  assert.equal(
    (await result(b.c.from('notifications').select('id').eq('source_id', muted))).length,
    0,
  );
  pass('preference disabled means no new in-app notification');
  await pb.goto(`${base}/homes/${h}/chat`);
  await pb
    .locator(`[data-message-id="${m.id}"]`)
    .getByRole('button', { name: 'Eliminar', exact: true })
    .click();
  await pb.getByRole('button', { name: 'Confirmar eliminación', exact: true }).click();
  await expect(pa.locator('blockquote')).toContainText('Mensaje eliminado', { timeout: 15000 });
  pass('any active member can remove, reference shows deleted placeholder');
  const bulk = Array.from({ length: 1200 }, (_, i) => ({
    id: randomUUID(),
    home_id: h,
    author_user_id: a.id,
    author_name: 'QA Ana',
    body: `History ${i}`,
    created_at: new Date(Date.now() - 86400000).toISOString(),
  }));
  for (let i = 0; i < bulk.length; i += 200)
    await result(admin.from('chat_messages').insert(bulk.slice(i, i + 200)));
  await pa.reload();
  await expect(pa.locator('.chat-message')).toHaveCount(50);
  await pa.getByRole('button', { name: 'Mensajes anteriores' }).click();
  await expect(pa.getByRole('button', { name: 'Volver a los recientes' })).toBeVisible();
  assert.equal(await pa.locator('.chat-message').count(), 50);
  for (const width of [320, 360, 768, 1440]) {
    await pa.setViewportSize({ width, height: 900 });
    assert.equal(
      await pa.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      `overflow ${width}`,
    );
  }
  await mkdir('test-results', { recursive: true });
  await pa.screenshot({ path: 'test-results/phase6-chat-desktop.png', fullPage: true });
  await pb.screenshot({ path: 'test-results/phase6-chat-mobile.png', fullPage: true });
  pass('1200-message history, bounded UI and responsive 320/360/768/1440');
  await contexts[0].setOffline(true);
  await pa.getByLabel('Mensaje', { exact: true }).fill('Offline draft');
  await pa.getByRole('button', { name: 'Enviar', exact: true }).click();
  await expect(pa.getByRole('alert').filter({ hasText: 'Sin conexión' })).toBeVisible();
  assert.equal(
    (await result(a.c.from('chat_messages').select('id').eq('body', 'Offline draft'))).length,
    0,
  );
  await contexts[0].setOffline(false);
  pass('offline write refuses with draft preserved; no false success');
  await rpc(b.c, 'leave_home', { target: h });
  assert.equal((await contexts[1].request.get(fileUrl)).status(), 404);
  assert.equal((await result(b.c.from('chat_messages').select('id').eq('home_id', h))).length, 0);
  assert.equal((await result(b.c.from('notifications').select('id').eq('home_id', h))).length, 0);
  pass('former member denied new chat, inbox and file access');
  const status = await rpc(admin, 'notification_job_status', {});
  assert.equal(status.last_run?.error_count, 0);
  assert.ok(status.last_run?.finished_at);
  console.log(
    'Cron last run:',
    status.last_run.started_at,
    'homes:',
    status.last_run.homes_processed,
  );
  assert.deepEqual(errors, []);
  await writeFile(
    'test-results/phase6-remote-summary.json',
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        chat: true,
        realtime: true,
        rls: true,
        privateFiles: true,
        inbox: true,
        preferences: true,
        offline: true,
        viewports: [320, 360, 768, 1440],
        cron: status.last_run,
      },
      null,
      2,
    ),
  );
  pass('no browser runtime exceptions');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  for (const [i, p] of pages.entries()) {
    await p
      .screenshot({ path: `test-results/phase6-failure-${i}.png`, fullPage: true })
      .catch(() => {});
    await writeFile(
      `test-results/phase6-failure-${i}.txt`,
      await p
        .locator('body')
        .innerText()
        .catch(() => ''),
    );
  }
  await writeFile(
    'test-results/phase6-failed-fixture.json',
    JSON.stringify({ homes, users: accounts.map((a) => a.id) }, null, 2),
  );
  throw error;
} finally {
  if (browser) await browser.close();
  let failed = false;
  if (files.length) {
    const r = await admin.storage.from('chat-files').remove(files);
    if (r.error) {
      failed = true;
      console.error('Fixture file cleanup failed');
    }
  }
  for (const h of homes) {
    const r = await admin.from('homes').delete().eq('id', h);
    if (r.error) {
      failed = true;
      console.error('Fixture home cleanup failed', r.error.code);
    }
  }
  for (const u of accounts) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) {
      failed = true;
      console.error('Fixture user cleanup failed', r.error.code);
    }
  }
  console.log('Cleaned this run’s test users, homes and files only.');
  if (failed) process.exitCode = 1;
}
