// Default is read-only. Destructive cleanup requires --execute; never selects by a loose prefix.
// Reads the local manifest and verifies every account and every (including former) member.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertDemoAccount,
  assertDemoHome,
  backupLocal,
  checked,
  config,
  homes,
  listUsers,
  lock,
  password,
  people,
  readState,
  rpc,
  saveState,
  signIn,
  snapshot,
  stableId,
} from './seed-demo.mjs';

export async function cleanupPlan(cfg, state) {
  const liveUsers = await listUsers(cfg.admin);
  const accounts = [];
  for (const account of state.users) {
    const user = liveUsers.find((u) => u.id === account.id);
    if (!user) continue;
    assertDemoAccount(user, account.email);
    if (!people.some((p) => p.email === account.email))
      throw new Error('Cuenta ajena al inventario demo.');
    accounts.push(account);
  }
  // A missing local manifest entry is never grounds to delete an untracked account or home.
  const ids = new Set(accounts.map((a) => a.id));
  const targets = [];
  for (const recorded of state.homes) {
    const home = await checked(
      cfg.admin.from('homes').select('id,name').eq('id', recorded.id).maybeSingle(),
    );
    if (!home) continue;
    if (home.name !== recorded.name || !homes.some((h) => h.name === home.name))
      throw new Error('Piso demo renombrado: revisión manual necesaria.');
    const members = await checked(
      cfg.admin.from('home_members').select('user_id,active').eq('home_id', home.id),
    );
    assertDemoHome(home, members, ids);
    targets.push({ ...home, members });
  }
  const targetIds = new Set(targets.map((h) => h.id));
  for (const account of accounts) {
    const memberships = await checked(
      cfg.admin.from('home_members').select('home_id').eq('user_id', account.id),
    );
    if (memberships.some((m) => !targetIds.has(m.home_id)))
      throw new Error('Una cuenta demo pertenece a otro piso: se cancela todo el cleanup.');
  }
  const objects = [];
  async function files(bucket, prefix) {
    // List only owned home/user prefixes; never enumerate another tenant's files.
    for (let offset = 0; ; offset += 100) {
      const entries = await checked(
        cfg.admin.storage.from(bucket).list(prefix, { limit: 100, offset }),
        'inventario Storage demo',
      );
      for (const entry of entries) {
        const path = `${prefix}/${entry.name}`;
        if (!entry.id) await files(bucket, path);
        else objects.push({ bucket, path });
      }
      if (entries.length < 100) break;
    }
  }
  const buckets = await checked(cfg.admin.storage.listBuckets(), 'listar buckets');
  for (const name of ['home-images', 'expense-receipts', 'rating-photos', 'chat-files']) {
    if (buckets.some((b) => b.id === name)) for (const home of targets) await files(name, home.id);
  }
  if (buckets.some((b) => b.id === 'avatars'))
    for (const account of accounts) await files('avatars', account.id);
  return { accounts, targets, objects };
}
async function main() {
  const args = process.argv.slice(2);
  if (
    args.some((a) => !['--dry-run', '--execute'].includes(a)) ||
    (args.includes('--execute') && args.includes('--dry-run'))
  )
    throw new Error('Uso: cleanup-demo.mjs [--dry-run | --execute]. Por defecto: dry-run.');
  const release = await lock();
  try {
    const cfg = await config();
    let state;
    try {
      state = await readState();
    } catch (e) {
      if (e.code !== 'ENOENT' || args.includes('--execute')) throw e;
      console.log('DRY RUN: no hay manifiesto local; ningún dato identificado para borrar.');
      return;
    }
    const plan = await cleanupPlan(cfg, state);
    console.log(
      args.includes('--execute')
        ? 'CLEANUP DEMO'
        : 'DRY RUN: no se borra ni modifica ningún dato remoto.',
    );
    for (const h of plan.targets)
      console.log(`Piso: ${h.name}; miembros históricos: ${h.members.length}`);
    console.log(
      `Cuentas demo: ${plan.accounts.length}; pisos: ${plan.targets.length}; archivos privados: ${plan.objects.length}.`,
    );
    console.log(JSON.stringify(await snapshot(cfg.admin, { homes: plan.targets }), null, 2));
    if (!args.includes('--execute')) return;
    await backupLocal();
    const value = await password();
    // Preserve an inventory for resuming an interrupted cleanup. Existing credentials remain local.
    state.cleanup = {
      startedAt: new Date().toISOString(),
      homeIds: plan.targets.map((h) => h.id),
      userIds: plan.accounts.map((a) => a.id),
      objects: plan.objects,
    };
    await saveState(state);
    for (const home of plan.targets) {
      // Recheck exclusivity immediately before each destructive operation.
      const fresh = await cleanupPlan(cfg, state);
      if (!fresh.targets.some((h) => h.id === home.id)) continue;
      const actor = plan.accounts.find((a) =>
        home.members.some((m) => m.user_id === a.id && m.active),
      );
      if (!actor) throw new Error('Piso demo sin miembro activo para liquidar saldos.');
      const c = await signIn(cfg, actor, value);
      const day = await rpc(c, 'home_local_date', { target: home.id });
      const balances = (await rpc(c, 'expense_balances', { target: home.id })).map((b) => ({
        ...b,
        amount: BigInt(b.balance),
      }));
      for (const debtor of balances.filter((b) => b.amount < 0n)) {
        for (const creditor of balances.filter((b) => b.amount > 0n)) {
          const total = -debtor.amount < creditor.amount ? -debtor.amount : creditor.amount;
          if (total <= 0n) continue;
          await rpc(c, 'record_settlement', {
            target: home.id,
            item: stableId(`cleanup:${home.id}:${debtor.user_id}:${creditor.user_id}:${total}`),
            sender: debtor.user_id,
            recipient: creditor.user_id,
            total: String(total),
            on_date: day,
          });
          debtor.amount += total;
          creditor.amount -= total;
        }
      }
      if (
        (await rpc(c, 'expense_balances', { target: home.id })).some(
          (b) => BigInt(b.balance) !== 0n,
        )
      )
        throw new Error('No se han liquidado todos los saldos demo.');
      for (const bucket of new Set(plan.objects.map((o) => o.bucket))) {
        const paths = plan.objects
          .filter((o) => o.bucket === bucket && o.path.startsWith(home.id + '/'))
          .map((o) => o.path);
        if (paths.length)
          await checked(cfg.admin.storage.from(bucket).remove(paths), 'borrar archivos demo');
      }
      // Admin deletion is necessary: delete_home refuses multiple active members.
      // Cascades delete ONLY the verified home; the finance invariant still runs in PostgreSQL.
      await checked(cfg.admin.from('homes').delete().eq('id', home.id), 'borrar piso demo');
      await c.auth.signOut({ scope: 'local' });
    }
    for (const account of plan.accounts) {
      const memberships = await checked(
        cfg.admin.from('home_members').select('home_id').eq('user_id', account.id),
      );
      if (memberships.length) throw new Error('La cuenta aún tiene membresías; no se borra.');
      const user = (
        await checked(cfg.admin.auth.admin.getUserById(account.id), 'verificar cuenta demo')
      ).user;
      assertDemoAccount(user, account.email);
      for (const bucket of new Set(plan.objects.map((o) => o.bucket))) {
        const paths = plan.objects
          .filter((o) => o.bucket === bucket && o.path.startsWith(account.id + '/'))
          .map((o) => o.path);
        if (paths.length)
          await checked(cfg.admin.storage.from(bucket).remove(paths), 'borrar avatar demo');
      }
      await checked(cfg.admin.auth.admin.deleteUser(account.id), 'borrar cuenta demo');
    }
    const remaining = await cleanupPlan(cfg, state);
    if (remaining.accounts.length || remaining.targets.length)
      throw new Error('Quedan datos demo por eliminar.');
    state.cleanup.completedAt = new Date().toISOString();
    await saveState(state);
    console.log('PASS cleanup: solo se han eliminado las cuentas y pisos demo del manifiesto.');
  } finally {
    await release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
