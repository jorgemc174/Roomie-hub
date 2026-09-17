// Development only. Admin access prepares/cleans isolated fixtures, never app operations.
import { createClient } from '@supabase/supabase-js';
import { chromium, expect } from '@playwright/test';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import sharp from 'sharp';
import assert from 'node:assert/strict';
process.loadEnvFile('.env.local');
const e = process.env,
  options = { auth: { persistSession: false, autoRefreshToken: false } };
const client = () =>
  createClient(e.NEXT_PUBLIC_SUPABASE_URL, e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, options);
const admin = createClient(
  e.NEXT_PUBLIC_SUPABASE_URL,
  e.SUPABASE_SECRET_KEY || e.SUPABASE_SERVICE_ROLE_KEY,
  options,
);
const accounts = [],
  homes = [],
  channels = [];
let browser;
const rows = async (query) => {
  const r = await query;
  if (r.error) throw new Error(`${r.error.code ?? ''}: ${r.error.message}`);
  return r.data;
};
const rpc = (c, name, args) => rows(c.rpc(name, args));
const pass = (s) => console.log(`PASS ${s}`);
const visit = async (p, url) => {
  await p.waitForLoadState('networkidle');
  await p.goto(url);
  await p.waitForLoadState('networkidle');
};
try {
  const probe = await client().rpc('community_balances', { target: randomUUID() });
  if (probe.error?.code === 'PGRST202')
    throw new Error('Apply migration 007 before remote validation');
  const access = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (access.error)
    throw new Error(`Fixture access: ${access.error.status} ${access.error.message}`);
  for (const name of ['Ana', 'Jorge', 'Pablo', 'Outside']) {
    const email = `roomiehub-community-${randomUUID()}@example.com`,
      password = `Aa1!${randomBytes(18).toString('hex')}`;
    const r = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name: `QA ${name}` },
    });
    if (r.error) throw r.error;
    const u = { id: r.data.user.id, email, password, c: client() };
    accounts.push(u);
    const login = await u.c.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
  }
  const [a, b, c, out] = accounts,
    h = await rpc(a.c, 'create_home', { home_name: 'QA Phase 5', home_currency: 'EUR' });
  homes.push(h);
  const inv = await rows(a.c.from('invitations').select('code').eq('home_id', h).single());
  for (const u of [b, c]) await rpc(u.c, 'join_home', { invite_code: inv.code });
  await rpc(a.c, 'initialize_rating_reasons', { target: h, language_code: 'es' });
  const reasons = await rows(a.c.from('rating_reasons').select('*').eq('home_id', h)),
    pos = reasons.find((r) => r.seed_key === 'default-1').id,
    neg = reasons.find((r) => r.seed_key === 'default-6').id;
  const rate = (u, reason, extra = {}) =>
    rpc(u.c, 'save_rating', {
      target: h,
      item: randomUUID(),
      expected_version: 0,
      person: b.id,
      reason,
      notes: '',
      anonymous: false,
      ...extra,
    });
  const state = async () =>
    (await rpc(a.c, 'community_balances', { target: h })).find((x) => x.user_id === b.id);
  const checkState = async (p, n) => {
    const s = await state();
    assert.equal(Number(s.positive_available), p);
    assert.equal(Number(s.negative_effective), n);
  };
  await rate(a, neg);
  const payloads = [];
  const session = await b.c.auth.getSession();
  await b.c.realtime.setAuth(session.data.session.access_token);
  const channel = b.c
    .channel(`community-qa-${randomUUID()}`, {
      config: { postgres_changes_options: { wait: true, timeout: 15000 } },
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'ratings', filter: `home_id=eq.${h}` },
      (p) => payloads.push(p),
    );
  channels.push({ c: b.c, channel });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Realtime subscription timeout')), 20000);
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve();
      } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
        clearTimeout(timer);
        reject(new Error(status));
      }
    });
  });
  let pa, pb, id;
  const base = e.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';
  if (e.SKIP_REMOTE_UI !== 'true') {
    browser = await chromium.launch({ headless: true });
    const contexts = await Promise.all([
      browser.newContext(),
      browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true, hasTouch: true }),
    ]);
    [pa, pb] = await Promise.all(contexts.map((x) => x.newPage()));
    for (const [i, u] of [a, b].entries()) {
      const p = [pa, pb][i];
      await visit(p, `${base}/login`);
      await p.locator('[name=email]').fill(u.email);
      await p.locator('[name=password]').fill(u.password);
      await p.locator('button[type=submit]').click();
      await p.waitForURL('**/homes');
      await visit(p, `${base}/homes/${h}/community`);
    }
    await pa
      .locator('summary')
      .filter({ hasText: /^Valorar$/ })
      .click();
    const form = pa
      .locator('form')
      .filter({ has: pa.locator('select[name=person]') })
      .filter({ has: pa.locator('select[name=reason]') });
    id = await form.locator('[name=id]').inputValue();
    await form.locator('[name=person]').selectOption(b.id);
    await form.locator('[name=reason]').selectOption(pos);
    await form.locator('[name=notes]').fill('QA anonymous positive');
    await form.locator('[name=anonymous]').check();
    const image = await sharp({
      create: { width: 40, height: 40, channels: 3, background: '#bacabc' },
    })
      .jpeg()
      .withExif({ IFD0: { Artist: `QA Ana ${a.id}` } })
      .toBuffer();
    await form
      .locator('[name=photo]')
      .setInputFiles({ name: 'ana-private-name.jpg', mimeType: 'image/jpeg', buffer: image });
    await form.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(form.getByRole('status')).toBeVisible({ timeout: 20000 });
    const article = pb.locator(`#rating-${id}`);
    await expect(article).toBeVisible({ timeout: 25000 });
    await expect(article.getByText('Autor: Autor anónimo', { exact: true })).toBeVisible();
    await expect(article.getByText('QA Ana', { exact: true })).toHaveCount(0);
    await expect(article.getByRole('link', { name: 'Ver foto' })).toBeVisible();
    pass(
      'authenticated Ana gives anonymous positive/photo; recipient sees it through Realtime without author',
    );
  } else {
    id = await rate(a, pos, { anonymous: true, notes: 'QA anonymous positive' });
    const path = await rpc(a.c, 'prepare_rating_photo', { target: h, item: id });
    const photo = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'red' } })
      .webp()
      .toBuffer();
    await rows(
      a.c.storage
        .from('rating-photos')
        .upload(path, photo, {
          contentType: 'image/webp',
          cacheControl: '0',
          headers: { 'cache-control': 'private, no-store, max-age=0' },
          upsert: false,
        }),
    );
    await rpc(a.c, 'attach_rating_photo', {
      target: h,
      item: id,
      expected_version: 1,
      object_path: path,
    });
    console.log('SKIP browser UI flows; photo API still tested');
  }
  await expect.poll(() => payloads.some((p) => p.new.id === id), { timeout: 20000 }).toBe(true);
  for (const p of payloads.filter((p) => p.new.id === id)) {
    assert.equal(JSON.stringify(p.new).includes(a.id), false);
    assert.equal('created_by' in p.new, false);
  }
  for (const u of [b, c]) {
    const rating = await rows(u.c.from('ratings').select('*').eq('id', id).single());
    assert.equal(JSON.stringify(rating).includes(a.id), false);
    const labels = await rpc(u.c, 'rating_author_labels', { target: h, items: [id] });
    assert.equal(labels[0].author_id, null);
    assert.equal(labels[0].author_name, null);
    assert.ok((await u.c.from('ratings').select('*,rating_authors(*)').eq('id', id)).error);
    assert.ok((await u.c.schema('community_private').from('rating_authors').select('*')).error);
  }
  assert.equal(
    (await rpc(a.c, 'rating_author_labels', { target: h, items: [id] }))[0].author_id,
    a.id,
  );
  const photographed = await rows(
    b.c.from('ratings').select('attachment_path').eq('id', id).single(),
  );
  if (photographed.attachment_path) {
    const path = photographed.attachment_path;
    assert.equal(path.includes(a.id), false);
    assert.equal(path.includes('ana'), false);
    const blob = await rows(b.c.storage.from('rating-photos').download(path)),
      meta = await sharp(Buffer.from(await blob.arrayBuffer())).metadata();
    assert.equal(meta.exif, undefined);
    assert.equal(meta.xmp, undefined);
    const info = await rows(b.c.storage.from('rating-photos').info(path));
    assert.equal(JSON.stringify(info).includes(a.id), false);
    assert.equal(JSON.stringify(info).includes('ana-private-name'), false);
    assert.ok((await out.c.storage.from('rating-photos').download(path)).error);
    pass(
      'private photo access, metadata and actual image bytes do not expose uploader; outsider denied',
    );
  }
  pass('anonymous table/RPC/Realtime/join/private-schema checks, including author-only identity');
  for (const table of ['ratings', 'rating_reasons', 'rating_redemptions', 'punishments']) {
    assert.equal((await rows(out.c.from(table).select('*').eq('home_id', h))).length, 0);
    assert.ok((await out.c.from(table).delete().eq('home_id', h)).error);
  }
  assert.ok((await out.c.rpc('reconcile_community', { target: h })).error);
  await rate(a, pos);
  await rate(c, pos);
  await checkState(0, 0);
  if (pb) {
    await expect
      .poll(async () => {
        const x = await state();
        return Number(x.positive_consumed);
      })
      .toBe(3);
    await expect(
      pb.locator(`#rating-${id}`).getByText('Positivo consumido', { exact: true }),
    ).toBeVisible({ timeout: 20000 });
  }
  pass('3 positives compensate oldest negative; UI updates consumed state');
  await rate(a, neg);
  await rate(a, pos);
  await rate(c, pos);
  await Promise.all([rate(a, pos), rate(c, pos)]);
  await checkState(1, 0);
  assert.equal(
    (
      await rows(
        a.c.from('rating_redemptions').select('id').eq('home_id', h).is('revoked_at', null),
      )
    ).length,
    2,
  );
  pass(
    'two real concurrent positive submissions: four available become one, exactly one additional redemption',
  );
  // Backdated membership is administrative fixture setup only, never a public time override.
  const old = new Date(Date.now() - 6 * 86400000).toISOString();
  await rows(admin.from('home_members').update({ joined_at: old }).eq('home_id', h));
  const due = new Date(Date.now() - 4 * 86400000 - 60000),
    day = due.toISOString().slice(0, 10);
  await rpc(a.c, 'save_chore', {
    target: h,
    chore: null,
    task_name: 'QA overdue',
    task_description: '',
    weight: 1,
    enabled: true,
    kind: 'daily',
    every_n: 1,
    anchor: day,
    mode: 'manual',
    rotation: [b.id],
    due_days: 0,
    due_time: due.toISOString().slice(11, 19),
    due_timezone: 'UTC',
  });
  await rpc(a.c, 'generate_chore_instances', { target: h, from_date: day, through_date: day });
  for (let k = 0; k < 10; k++) await rpc(a.c, 'reconcile_community', { target: h });
  const auto = await rows(
    a.c.from('ratings').select('*').eq('home_id', h).eq('source', 'task_overdue'),
  );
  assert.equal(auto.length, 4);
  assert.ok(auto.every((x) => x.target_user_id === b.id));
  await rpc(a.c, 'complete_chore', { target: h, instance: auto[0].source_id });
  await rpc(a.c, 'reconcile_community', { target: h });
  assert.equal(
    (await rows(a.c.from('ratings').select('id').eq('home_id', h).eq('source', 'task_overdue')))
      .length,
    4,
  );
  if (pb) {
    await visit(pb, `${base}/homes/${h}/community`);
    await expect(pb.getByText(/Tarea atrasada: QA overdue/)).toHaveCount(4);
    await visit(pb, `${base}/homes/${h}/community`);
    await expect(pb.getByText(/Tarea atrasada: QA overdue/)).toHaveCount(4);
  }
  pass(
    'four complete overdue days, correct recipient, ten reconciliations/reloads and completion never duplicate',
  );
  await rate(a, neg);
  await Promise.all([
    rpc(a.c, 'reconcile_community', { target: h }),
    rpc(c.c, 'reconcile_community', { target: h }),
  ]);
  await checkState(1, 5);
  const punishments = await rows(a.c.from('punishments').select('*').eq('home_id', h));
  assert.equal(punishments.length, 1);
  assert.equal(punishments[0].threshold, 5);
  assert.equal(punishments[0].severity, 'light');
  if (pa) {
    await visit(pa, `${base}/homes/${h}/community?tab=punishments`);
    const p = pa.locator(`#punishment-${punishments[0].id}`);
    await p.locator('[name=description]').fill('Limpiar cocina extra');
    await p.locator('[name=finish]').check();
    await p.getByRole('button', { name: 'Guardar', exact: true }).click();
    await expect(p.getByText(/Cumplido por: QA Ana/)).toBeVisible();
    await visit(pb, `${base}/homes/${h}/community?tab=punishments`);
    await expect(pb.getByText(/Cumplido por: QA Ana/)).toBeVisible();
    await visit(pb, `${base}/homes/${h}/community?tab=ranking`);
    await expect(pb.getByRole('heading', { name: 'Ranking', exact: true })).toBeVisible();
    await expect(pb.getByRole('heading', { name: 'QA Jorge', exact: true })).toBeVisible();
    assert.equal(await pb.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await mkdir('test-results/community-remote', { recursive: true });
    await pb.screenshot({
      path: 'test-results/community-remote/ranking-mobile.png',
      fullPage: true,
    });
    await visit(pb, `${base}/profile`);
    await pb.getByLabel('Idioma').selectOption('en');
    await pb.getByLabel('Apariencia').selectOption('dark');
    await pb.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
    await expect(pb.locator('html')).toHaveAttribute('lang', 'en');
    await visit(pb, `${base}/homes/${h}/community`);
    await expect(pb.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(pb.getByRole('heading', { name: 'Living together', exact: true })).toBeVisible();
    assert.equal(await pb.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await pb.screenshot({
      path: 'test-results/community-remote/points-mobile-dark.png',
      fullPage: true,
    });
    pass(
      'single threshold 5, define/complete without spending negatives, ranking and English/dark mobile',
    );
  } else
    await rpc(a.c, 'save_punishment', {
      target: h,
      item: punishments[0].id,
      expected_version: 1,
      notes: 'Extra cleaning',
      finish: true,
    });
  await rpc(b.c, 'leave_home', { target: h });
  assert.equal((await rows(b.c.from('ratings').select('id').eq('home_id', h))).length, 0);
  if (photographed.attachment_path) {
    const path = photographed.attachment_path;
    const permitted = await rpc(b.c, 'rating_photo_access', { object_path: path });
    const info = await b.c.storage.from('rating-photos').info(path);
    const ordinary = await b.c.storage.from('rating-photos').download(path);
    const fresh = await b.c.storage
      .from('rating-photos')
      .download(path, { cacheNonce: randomUUID() }, { cache: 'no-store' });
    assert.equal(permitted, false);
    assert.ok(info.error);
    assert.ok(fresh.error);
    // A prior CDN response can outlive RLS. This is a provider limitation, not a successful revocation.
    if (!ordinary.error)
      console.warn(
        'LIMITATION: Supabase CDN still serves previously fetched URL; fresh origin access and app route must deny it.',
      );
    if (pb) {
      const response = await pb.request.get(`${base}/homes/${h}/community/photo/${id}`);
      assert.equal(response.status(), 404);
    }
  }
  pass(
    'former member loses ratings, Storage metadata, fresh photo access and app route; history retained',
  );
  await rpc(b.c, 'join_home', { invite_code: inv.code });
  const epoch = await rows(
    b.c
      .from('home_members')
      .select('penalty_active_since')
      .eq('home_id', h)
      .eq('user_id', b.id)
      .single(),
  );
  assert.ok(
    epoch.penalty_active_since,
    'Apply migration 008: rejoining must start a new penalty eligibility window',
  );
  await rpc(a.c, 'save_chore', {
    target: h,
    chore: null,
    task_name: 'QA rejoin gap',
    task_description: '',
    weight: 1,
    enabled: true,
    kind: 'daily',
    every_n: 1,
    anchor: day,
    mode: 'manual',
    rotation: [b.id],
    due_days: 0,
    due_time: due.toISOString().slice(11, 19),
    due_timezone: 'UTC',
  });
  await rpc(a.c, 'generate_chore_instances', { target: h, from_date: day, through_date: day });
  await rpc(a.c, 'reconcile_community', { target: h });
  assert.equal(
    (
      await rows(
        a.c
          .from('ratings')
          .select('id')
          .eq('home_id', h)
          .eq('source', 'task_overdue')
          .eq('reason_name', 'QA rejoin gap'),
      )
    ).length,
    0,
  );
  assert.equal(
    (await rows(a.c.from('ratings').select('id').eq('home_id', h).eq('source', 'task_overdue')))
      .length,
    4,
  );
  pass(
    '008 rejoin starts a fresh eligibility epoch, no past gap penalties; previous completed history unchanged',
  );
} finally {
  if (browser) await browser.close();
  for (const x of channels) await x.c.removeChannel(x.channel);
  let failed = false;
  for (const h of homes) {
    const rated = await admin.from('ratings').select('attachment_path').eq('home_id', h);
    const paths = (rated.data ?? []).map((x) => x.attachment_path).filter(Boolean);
    // Also remove unlinked upload objects from this fixture prefix.
    const dirs = await admin.storage.from('rating-photos').list(h);
    for (const d of dirs.data ?? []) {
      const files = await admin.storage.from('rating-photos').list(`${h}/${d.name}`);
      for (const f of files.data ?? []) paths.push(`${h}/${d.name}/${f.name}`);
    }
    if (paths.length) {
      const r = await admin.storage.from('rating-photos').remove([...new Set(paths)]);
      if (r.error) {
        failed = true;
        console.error('Photo cleanup failed', h, r.error.message);
      }
    }
    const r = await admin.from('homes').delete().eq('id', h);
    if (r.error) {
      failed = true;
      console.error('Home cleanup failed', h, r.error.message);
    }
  }
  for (const u of accounts) {
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) {
      failed = true;
      console.error('User cleanup failed', u.id, r.error.message);
    }
  }
  console.log('Cleanup targeted only this run’s fixture accounts, home and photos.');
  if (failed) process.exitCode = 1;
}
