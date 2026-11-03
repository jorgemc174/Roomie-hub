// Local administrative tool. Business data is written only through authenticated public RPCs.
// Usage: NODE_USE_ENV_PROXY=1 node scripts/seed-demo.mjs [--verify-ui]
// Re-running preserves the original reference day and completed operations, including manual edits.
// Contract limits: expenses/occurrence periods/absences can cover eight weeks; Auth membership,
// completion timestamps, chat and notices retain their genuine creation time. Calendar RPCs reject
// past_start, so activities/reservations are upcoming. Chores expose recurrence only (no one-off
// kind). Departure requires zero balance: the former member leaves settled; a subsequent correction
// to an existing expense creates a legitimate historical debt of EUR 3 without bypassing leave_home.
import { createClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'node:crypto';
import { chmod, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

export const namespace = 'roomiehub-demo-v1';
export const project = 'hypfozjfkfpyqqdqsucm';
export const directory = join(homedir(), '.local/share/roomiehub-demo');
export const people = [
  ['Ana', 'García'],
  ['Pablo', 'Martínez'],
  ['Lucía', 'Fernández'],
  ['Carlos', 'López'],
  ['Marta', 'Sánchez'],
  ['Diego', 'Romero'],
  ['Elena', 'Navarro'],
  ['Javier', 'Ruiz'],
  ['Sara', 'Moreno'],
  ['Álvaro', 'Torres'],
  ['Paula', 'Díaz'],
  ['Marcos', 'Serrano'],
  ['Irene', 'Castro'],
  ['Adrián', 'Ortega'],
  ['Clara', 'Rubio'],
  ['Sergio', 'Molina'],
].map(([first, last]) => ({
  name: `${first} ${last}`,
  email: `demo.${first}.${last}@roomiehub-demo.test`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase(),
}));
export const homes = [
  { name: 'Demo · La casa de Ruzafa · Valencia', members: [0, 1, 2, 3, 4], former: 4 },
  { name: 'Demo · Piso de Chamberí · Madrid', members: [0, 5, 6, 7] },
  { name: 'Demo · El balcón de Gràcia · Barcelona', members: [8, 9, 10] },
  { name: 'Demo · Patio de Triana · Sevilla', members: [11, 12, 13] },
  { name: 'Demo · Junto a la ría · Bilbao', members: [14, 15] },
];
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const statePath = join(directory, 'state.json');
const credentialsPath = join(directory, 'cuentas.md');
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');
export const stableId = (label) => {
  const h = createHash('sha256').update(`${namespace}:${label}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export const dateOffset = (day, offset) =>
  new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86400000).toISOString().slice(0, 10);
export function assertDemoAccount(user, expectedEmail) {
  if (
    !user ||
    !people.some((p) => p.email === user.email) ||
    (expectedEmail && user.email !== expectedEmail) ||
    user.user_metadata?.demo !== true ||
    user.user_metadata?.demo_seed !== namespace
  )
    throw new Error('Cuenta fuera del conjunto demo autorizado; operación cancelada.');
}
export function assertAccountContinuity(user, recorded) {
  if (recorded && (!user || user.id !== recorded.id))
    throw new Error(
      'Cuenta del manifiesto ausente o distinta; no se recrea ni cambia su contraseña.',
    );
}
export function assertDemoHome(home, members, demoIds) {
  if (
    !home ||
    !homes.some((h) => h.name === home.name) ||
    !members.length ||
    members.some((m) => !demoIds.has(m.user_id))
  )
    throw new Error('Piso sin identificación demo exclusiva; operación cancelada.');
}
export async function checked(query, label = 'consulta') {
  const { data, error } = await query;
  // Do not echo payloads, Auth errors, invites, credentials or server details.
  if (error) throw new Error(`${label}: ${error.code || error.status || 'error'}`);
  return data;
}
export const rpc = (c, name, args) => checked(c.rpc(name, args), name);
export async function config() {
  const env = parseEnv(await readFile(join(homedir(), 'Roomie-hub/.env.production'), 'utf8'));
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (
    url !== `https://${project}.supabase.co` ||
    !env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    !env.SUPABASE_SECRET_KEY
  )
    throw new Error('Configuración incompleta o proyecto distinto del autorizado.');
  return {
    url,
    key: env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    admin: createClient(url, env.SUPABASE_SECRET_KEY, options),
  };
}
export async function listUsers(admin) {
  const users = [];
  for (let page = 1; ; page++) {
    const data = await checked(
      admin.auth.admin.listUsers({ page, perPage: 100 }),
      'listar cuentas',
    );
    users.push(...data.users);
    if (data.users.length < 100) return users;
  }
}
export async function readState() {
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  if (
    state.namespace !== namespace ||
    state.project !== project ||
    !/^\d{4}-\d{2}-\d{2}$/.test(state.day)
  )
    throw new Error('Manifiesto demo no válido.');
  return state;
}
async function atomicFile(path, text) {
  const temporary = `${path}.tmp`;
  await writeFile(temporary, text, { mode: 0o600 });
  await chmod(temporary, 0o600);
  await rename(temporary, path);
}
export const saveState = (state) => atomicFile(statePath, JSON.stringify(state, null, 2) + '\n');
export async function backupLocal() {
  const suffix = `.bak-${stamp()}`;
  for (const path of [statePath, credentialsPath]) {
    try {
      await copyFile(path, path + suffix);
      await chmod(path + suffix, 0o600);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
}
export async function lock() {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const path = join(directory, '.lock');
  try {
    await mkdir(path, { mode: 0o700 });
  } catch {
    throw new Error(
      'Otra operación demo está activa (.lock). Comprueba el proceso antes de retirarlo.',
    );
  }
  return () => rm(path, { recursive: true });
}
export async function password() {
  const text = await readFile(credentialsPath, 'utf8');
  const value = text.match(/^Contraseña común: `([^`]+)`$/m)?.[1];
  if (!value)
    throw new Error('Faltan las credenciales locales; no se cambian contraseñas existentes.');
  return value;
}
async function writeCredentials(value) {
  const lines = people.map(
    (p, i) =>
      `| ${p.name} | ${p.email} | ${homes
        .filter((h) => h.members.includes(i))
        .map(
          (h) => h.name + (h.former === i ? ' (antigua miembro; ajuste histórico pendiente)' : ''),
        )
        .join('; ')} |`,
  );
  await atomicFile(
    credentialsPath,
    `# Cuentas demo RoomieHub\n\nAcceso: https://roomie-hub.vercel.app/login\n\nContraseña común: \`${value}\`\n\n| Nombre | Correo | Pisos |\n| --- | --- | --- |\n${lines.join('\n')}\n\nSolo pruebas manuales. Canales externos desactivados. No publicar este archivo.\n`,
  );
}
export async function signIn(cfg, account, value) {
  const c = createClient(cfg.url, cfg.key, options);
  const data = await checked(
    c.auth.signInWithPassword({ email: account.email, password: value }),
    'inicio de sesión demo',
  );
  if (data.user.id !== account.id) throw new Error('La sesión no corresponde a la cuenta demo.');
  return c;
}
export const countTables = [
  'home_members',
  'chores',
  'chore_instances',
  'absences',
  'shopping_lists',
  'shopping_items',
  'expenses',
  'settlements',
  'recurring_expenses',
  'recurring_expense_instances',
  'resources',
  'reservations',
  'activities',
  'activity_members',
  'chat_messages',
  'chat_reactions',
  'ratings',
  'notifications',
];
export async function snapshot(admin, state) {
  const result = {};
  for (const h of state.homes) {
    const counts = {};
    for (const table of countTables) {
      const r = await admin
        .from(table)
        .select('*', { count: 'exact', head: true })
        .eq('home_id', h.id);
      if (r.error) throw new Error(`recuento ${table}: ${r.error.code}`);
      counts[table] = r.count;
    }
    const members = await checked(admin.from('home_members').select('active').eq('home_id', h.id));
    counts.active_members = members.filter((m) => m.active).length;
    result[h.name] = counts;
  }
  return result;
}
export async function seedHome(state, definition, home, accounts, persist = saveState) {
  const h = home.id,
    prefix = h + ':';
  const all = definition.members.map((i) => accounts[i]);
  const members = definition.members.filter((i) => i !== definition.former).map((i) => accounts[i]);
  const owner = members[0],
    c = owner.c;
  const day = state.day,
    start = dateOffset(day, -55),
    tomorrow = dateOffset(day, 1);
  async function once(label, action) {
    const key = prefix + label;
    if (Object.hasOwn(state.done, key)) return state.done[key];
    const result = await action();
    state.done[key] = result ?? true;
    await persist(state);
    return result;
  }
  async function findOrCreate(table, label, query, action) {
    return once(label, async () => {
      const rows = await checked(query);
      if (rows.length > 1) throw new Error(`Ambigüedad demo en ${table}.`);
      return rows[0]?.id || action();
    });
  }
  await once('join-members', async () => {
    const invitation = await checked(
      c.from('invitations').select('code').eq('home_id', h).single(),
    );
    const existing = await checked(
      c.from('home_members').select('user_id,active').eq('home_id', h),
    );
    for (const a of all) {
      if (!existing.some((m) => m.user_id === a.id))
        await rpc(a.c, 'join_home', { invite_code: invitation.code });
    }
  });
  // Give the former member genuine financial history, settle it, then leave normally.
  if (definition.former !== undefined) {
    const former = accounts[definition.former];
    await once('former-history', async () => {
      await rpc(owner.c, 'save_expense', {
        target: h,
        item: stableId(prefix + 'former-expense'),
        expected_version: 0,
        body: {
          title: 'Cena de despedida de Marta',
          amount: '6000',
          date: dateOffset(day, -42),
          payer: owner.id,
          category: 'food',
          split_mode: 'equal',
          participants: [owner, former].map((a) => ({ user_id: a.id, weight: '1' })),
        },
      });
      await rpc(former.c, 'record_settlement', {
        target: h,
        item: stableId(prefix + 'former-payment'),
        sender: former.id,
        recipient: owner.id,
        total: '3000',
        on_date: dateOffset(day, -41),
      });
    });
    await once('former-leave', async () => {
      const m = await checked(
        owner.c
          .from('home_members')
          .select('active')
          .eq('home_id', h)
          .eq('user_id', former.id)
          .single(),
      );
      if (m.active) await rpc(former.c, 'leave_home', { target: h });
    });
    await once('former-adjustment', async () => {
      const item = stableId(prefix + 'former-expense');
      const old = await checked(
        c.from('expenses').select('amount,version').eq('home_id', h).eq('id', item).single(),
      );
      // Read before retrying an edit: the RPC's create UUID does not idempotently replay edits.
      if (old.version === 2 && String(old.amount) === '6600') return;
      if (old.version !== 1 || String(old.amount) !== '6000')
        throw new Error('El gasto histórico demo cambió; no se sobrescribe.');
      await rpc(c, 'save_expense', {
        target: h,
        item,
        expected_version: 1,
        body: {
          title: 'Cena de despedida de Marta · ajuste del ticket',
          amount: '6600',
          date: dateOffset(day, -42),
          payer: owner.id,
          category: 'food',
          split_mode: 'equal',
          participants: [owner, former].map((a) => ({ user_id: a.id, weight: '1' })),
        },
      });
    });
  }
  console.log(`${home.name}: tareas, ausencias y compra`);
  for (const [index, [name, kind, n, weight]] of [
    ['Limpiar cocina', 'weekly', 1, 4],
    ['Limpiar baño', 'weekly', 1, 5],
    ['Recoger salón', 'days', 3, 2],
    ['Sacar basura', 'days', 2, 1],
    ['Fregar suelo', 'weekly', 1, 3],
    ['Revisar despensa', 'monthly', 1, 2],
  ].entries()) {
    await findOrCreate(
      'chores',
      `chore-${index}`,
      c.from('chores').select('id').eq('home_id', h).eq('name', name),
      () =>
        rpc(c, 'save_chore', {
          target: h,
          chore: null,
          task_name: name,
          task_description:
            index === 1
              ? 'Espejo, lavabo, ducha y suelo; dejar los productos bajo el lavabo.'
              : 'Dejar el espacio recogido y listo para el siguiente compañero.',
          weight,
          enabled: true,
          kind,
          every_n: n,
          anchor: start,
          mode: index % 2 ? 'manual' : 'automatic',
          rotation: index % 2 ? members.map((a) => a.id) : [],
          due_days: index === 3 ? 1 : 6,
          due_time: '21:00',
          due_timezone: 'Europe/Madrid',
        }),
    );
  }
  for (const [index, from, to] of [
    [1, -26, -22],
    [members.length - 1, 3, 6],
  ]) {
    const person = members[index];
    await findOrCreate(
      'absences',
      `absence-${from}`,
      c
        .from('absences')
        .select('id')
        .eq('home_id', h)
        .eq('user_id', person.id)
        .eq('start_date', dateOffset(day, from)),
      () =>
        rpc(person.c, 'save_absence', {
          target: h,
          absence: null,
          person: person.id,
          starts: dateOffset(day, from),
          ends: dateOffset(day, to),
          remove: false,
        }),
    );
  }
  await once('generate-history', () =>
    rpc(c, 'generate_chore_instances', { target: h, from_date: start, through_date: tomorrow }),
  );
  await once('complete-history', async () => {
    const instances = await checked(
      c
        .from('chore_instances')
        .select('id,assignee_id,period_start,completed_at,cancelled_at')
        .eq('home_id', h)
        .order('period_start')
        .order('id'),
    );
    for (const [index, item] of instances.entries()) {
      if (!item.completed_at && !item.cancelled_at && item.period_start < day && index % 9 !== 0) {
        const actor = members.find((a) => a.id === item.assignee_id) || owner;
        await rpc(actor.c, 'complete_chore', { target: h, instance: item.id });
      }
    }
  });
  for (const [index, [name, items, complete]] of [
    [
      'Compra de la semana',
      ['Leche de avena', 'Pan integral', 'Tomates', 'Huevos', 'Café', 'Papel higiénico'],
      false,
    ],
    ['Limpieza y básicos', ['Lavavajillas', 'Bolsas de basura', 'Bayetas', 'Detergente'], false],
    ['Compra del finde', ['Arroz', 'Verduras', 'Aceite de oliva', 'Fruta'], true],
  ].entries()) {
    const list = await findOrCreate(
      'shopping_lists',
      `list-${index}`,
      c.from('shopping_lists').select('id').eq('home_id', h).eq('name', name),
      () => rpc(c, 'shopping_command', { target: h, operation: 'create_list', label: name }),
    );
    let firstItem;
    for (const [j, name] of items.entries()) {
      const item = await findOrCreate(
        'shopping_items',
        `list-${index}-item-${j}`,
        c
          .from('shopping_items')
          .select('id')
          .eq('home_id', h)
          .eq('shopping_list_id', list)
          .eq('name', name),
        () =>
          rpc(members[j % members.length].c, 'shopping_command', {
            target: h,
            operation: 'add_item',
            list_id: list,
            label: name,
          }),
      );
      if (j === 0) firstItem = item;
    }
    if (!complete)
      await once(`checked-${index}`, () =>
        rpc(c, 'shopping_command', {
          target: h,
          operation: 'toggle_item',
          list_id: list,
          item_id: firstItem,
          checked: true,
        }),
      );
    if (complete)
      await once(`list-complete-${index}`, () =>
        rpc(c, 'shopping_command', { target: h, operation: 'complete_list', list_id: list }),
      );
  }
  console.log(`${home.name}: ocho semanas de gastos, recurrencias y pagos`);
  function expense(title, amount, category, offset, index, mode = 'equal') {
    const selected = mode === 'custom' ? members.slice(0, 2) : members;
    const weights =
      mode === 'custom'
        ? [(BigInt(amount) * 3n) / 5n, BigInt(amount) - (BigInt(amount) * 3n) / 5n].map(String)
        : mode === 'percentage'
          ? selected.map((_, j) =>
              String(Math.floor(10000 / selected.length) + (j < 10000 % selected.length ? 1 : 0)),
            )
          : selected.map(() => '1');
    return {
      title,
      amount: String(amount),
      date: dateOffset(day, offset),
      payer: members[index % members.length].id,
      category,
      split_mode: mode,
      participants: selected.map((a, j) => ({ user_id: a.id, weight: weights[j] })),
    };
  }
  const categories = [
    ['groceries', 'Compra semanal del mercado', 6825],
    ['rent', 'Alquiler del piso', members.length * 34000],
    ['electricity', 'Factura de luz', 7852],
    ['water', 'Recibo de agua', 3140],
    ['internet', 'Fibra compartida', 3990],
    ['cleaning', 'Productos de limpieza', 1845],
    ['transport', 'Taxi de vuelta a casa', 2260],
    ['leisure', 'Entradas de cine', 3480],
    ['food', 'Cena de pizzas', 4270],
    ['home', 'Estantería para el salón', 7599],
    ['subscriptions', 'Música compartida', 1799],
    ['other', 'Copia de llaves', 1250],
  ];
  for (const [index, [category, title, amount]] of categories.entries()) {
    const body = expense(
      title,
      amount,
      category,
      -52 + index * 4,
      index,
      ['equal', 'custom', 'percentage'][index % 3],
    );
    await once(`expense-category-${category}`, () =>
      rpc(members[index % members.length].c, 'save_expense', {
        target: h,
        item: stableId(prefix + 'expense-' + category),
        expected_version: 0,
        body,
      }),
    );
  }
  for (let week = 0; week < 8; week++) {
    const body = expense(
      `Supermercado · semana ${week + 1}`,
      4380 + week * 317 + homes.indexOf(definition) * 113,
      'groceries',
      -53 + week * 7,
      week,
    );
    await once(`expense-week-${week}`, () =>
      rpc(members[week % members.length].c, 'save_expense', {
        target: h,
        item: stableId(prefix + 'expense-week-' + week),
        expected_version: 0,
        body,
      }),
    );
  }
  for (const [index, kind] of ['fixed', 'variable'].entries()) {
    const body = expense(
      kind === 'fixed' ? 'Internet · recibo mensual' : 'Electricidad · pendiente de factura',
      kind === 'fixed' ? 3990 : 7500,
      kind === 'fixed' ? 'internet' : 'electricity',
      -49,
      index,
    );
    await once('recurring-' + kind, () =>
      rpc(c, 'save_recurring_expense', {
        target: h,
        item: stableId(prefix + 'recurring-' + kind),
        expected_version: 0,
        body,
        recurrence_kind: kind,
        freq: 'monthly',
        n: 1,
        anchor: dateOffset(day, -49),
        enabled: true,
      }),
    );
  }
  await once('generate-recurring', () => rpc(c, 'generate_recurring_expenses', { target: h }));
  const variablePlan = await once('variable-plan', async () => {
    const pending = await checked(
      c
        .from('recurring_expense_instances')
        .select('id,template')
        .eq('home_id', h)
        .eq('status', 'pending')
        .order('period_date'),
    );
    return { item: pending[0] || null };
  });
  await once('confirm-variable', async () => {
    if (variablePlan.item)
      await rpc(members[1].c, 'confirm_recurring_expense', {
        target: h,
        item: variablePlan.item.id,
        body: { ...variablePlan.item.template, amount: '7234' },
      });
  });
  const paymentPlan = await once('payment-plan', async () => {
    // Half-payments keep realistic outstanding balances, without inventing a departure debt.
    const balances = await rpc(c, 'expense_balances', { target: h });
    const debtors = balances.filter(
      (b) => BigInt(b.balance) < -100n && members.some((a) => a.id === b.user_id),
    );
    const creditors = balances.filter((b) => BigInt(b.balance) > 0n);
    const payments = [];
    for (const debtor of debtors) {
      const creditor = creditors.find((b) => BigInt(b.balance) > 0n);
      if (!creditor) break;
      const due = -BigInt(debtor.balance) / 2n;
      const total = due < BigInt(creditor.balance) ? due : BigInt(creditor.balance);
      payments.push({
        target: h,
        item: stableId(prefix + 'payment-' + debtor.user_id),
        sender: debtor.user_id,
        recipient: creditor.user_id,
        total: String(total),
        on_date: dateOffset(day, -2),
      });
      creditor.balance = String(BigInt(creditor.balance) - total);
    }
    return payments;
  });
  for (const payment of paymentPlan)
    await once(`payment-${payment.item}`, () =>
      rpc(members.find((a) => a.id === payment.sender)?.c || c, 'record_settlement', payment),
    );
  console.log(`${home.name}: actividades, reservas, conversación y valoraciones`);
  await once('resources', () => rpc(c, 'initialize_resources', { target: h, language_code: 'es' }));
  const resources = await checked(
    c.from('resources').select('id,name').eq('home_id', h).eq('active', true).order('name'),
  );
  for (let index = 0; index < 6; index++) {
    const actor = members[index % members.length];
    const resource = resources[index % resources.length];
    await once(`reservation-${index}`, () =>
      rpc(actor.c, 'save_reservation', {
        target: h,
        item: stableId(prefix + 'reservation-' + index),
        expected_version: 0,
        resource: resource.id,
        person: actor.id,
        label: resource.name.includes('Lavadora')
          ? 'Colada de sábanas'
          : resource.name.includes('Cocina')
            ? 'Preparar tuppers'
            : 'Ducha al volver del gimnasio',
        start_local: `${dateOffset(day, 1 + index)}T18:00`,
        end_local: `${dateOffset(day, 1 + index)}T19:00`,
        expected_timezone: 'Europe/Madrid',
      }),
    );
  }
  for (const [index, [title, kind, place, notes]] of [
    [
      'Cena de tortillas y juegos',
      'home',
      'Salón del piso',
      'Cada uno trae algo para compartir. ¿Quién se apunta?',
    ],
    [
      'Paseo y café el domingo',
      'outside',
      'Plaza del barrio',
      'Nos vemos junto a la fuente; después buscamos una terraza.',
    ],
    [
      'Noche de peli y palomitas',
      'home',
      'Salón del piso',
      'Elegimos la peli entre todos por el chat.',
    ],
  ].entries()) {
    const id = stableId(prefix + 'activity-' + index);
    await once(`activity-${index}`, () =>
      rpc(members[index % members.length].c, 'save_activity_plan', {
        target: h,
        item: id,
        expected_version: 0,
        label: title,
        notes,
        place,
        kind,
        participants: [],
        start_local: `${dateOffset(day, index + 2)}T20:00`,
        end_local: `${dateOffset(day, index + 2)}T22:00`,
        expected_timezone: 'Europe/Madrid',
      }),
    );
    for (const [j, actor] of members.entries())
      await once(`response-${index}-${j}`, () =>
        rpc(actor.c, 'respond_activity', {
          target: h,
          item: id,
          answer: ['going', 'maybe', 'not_going'][(index + j) % 3],
        }),
      );
  }
  const messages = [
    '¡Buenas! He dejado café recién hecho en la cocina ☕',
    '¡Gracias! Hoy salgo pronto, luego recojo el salón.',
    '¿Queda leche? Voy al súper al salir del trabajo.',
    'Nos falta leche de avena y papel. Lo he apuntado en la lista 🙂',
    'Ya está comprado. He guardado el gasto para repartirlo.',
    'La lavadora queda libre a las siete, por si alguien la necesita.',
    'Perfecto, me reservo un rato para las sábanas.',
    'El finde voy a ver a mi familia; ya he apuntado la ausencia.',
    '¿Os apetece cena de tortillas y juegos esta semana?',
    '¡Me apunto! Puedo preparar ensalada 🥗',
    'Yo quizá llegue tarde, os confirmo mañana.',
    'He añadido las actividades al calendario para que respondamos allí.',
    'La factura de luz ha salido algo más baja este mes.',
    'Luego reviso mi parte y te hago el pago. ¡Gracias por adelantarlo!',
    'He limpiado el baño y repuesto el jabón.',
    '¡Gracias! Ha quedado genial 🙌',
    'Para separar residuos, dejo esta guía: https://www.ecoembes.com/',
    '¿Peli el viernes? Yo llevo palomitas 🍿',
    'Sí, pero bajamos el volumen a partir de las once.',
    'Trato hecho. Qué gusto organizarse así 😊',
  ];
  for (const [index, body] of messages.entries()) {
    const actor = members[index % members.length];
    await once(`message-${index}`, () =>
      rpc(actor.c, 'send_chat_message', {
        target: h,
        item: stableId(prefix + 'message-' + index),
        message_body: body,
        reply: [3, 9, 15].includes(index) ? stableId(prefix + 'message-' + (index - 1)) : null,
        files: [],
      }),
    );
  }
  await once('reaction', () =>
    rpc(members[1].c, 'set_chat_reaction', {
      target: h,
      item: stableId(prefix + 'message-0'),
      reaction: '❤️',
      enabled: true,
    }),
  );
  await once('rating-reasons', () =>
    rpc(c, 'initialize_rating_reasons', { target: h, language_code: 'es' }),
  );
  const reasons = await checked(c.from('rating_reasons').select('id,seed_key').eq('home_id', h));
  for (let index = 0; index < 4; index++)
    await once(`rating-${index}`, () =>
      rpc(members[index % members.length].c, 'save_rating', {
        target: h,
        item: stableId(prefix + 'rating-' + index),
        expected_version: 0,
        person: members[(index + 1) % members.length].id,
        reason: reasons.find((r) => r.seed_key === (index === 3 ? 'default-6' : 'default-1')).id,
        notes:
          index === 3
            ? 'Quedaron platos en el fregadero después de cenar.'
            : 'Gracias por dejar la cocina recogida antes de irte.',
        anonymous: index === 3,
      }),
    );
}

export async function verifyUi(state, value) {
  const { chromium, expect } = await import('@playwright/test');
  const proxy = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  const browser = await chromium
    .launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium-browser',
      ...(proxy ? { proxy: { server: proxy, bypass: 'localhost,127.0.0.1' } } : {}),
    })
    .catch(() => {
      throw new Error('No se pudo iniciar Chromium para la verificación demo.');
    });
  const output = '/tmp/claude-1000/verif';
  await mkdir(output, { recursive: true, mode: 0o700 });
  try {
    for (const [n, index] of [0, 14].entries()) {
      const account = state.users[index];
      const home = state.homes.find((h) =>
        homes.find((d) => d.name === h.name).members.includes(index),
      );
      const context = await browser.newContext({
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.name));
      try {
        await page.goto('https://roomie-hub.vercel.app/login', { waitUntil: 'networkidle' });
        await page.locator('[name=email]').fill(account.email);
        await page.locator('[name=password]').fill(value);
        await page.getByRole('button', { name: 'Iniciar sesión', exact: true }).click();
        await page.waitForURL('**/homes', { timeout: 60000 });
        await expect(page.locator('.home-card').filter({ hasText: home.name })).toBeVisible();
        await page.screenshot({ path: `${output}/seed_${n + 1}_pisos.png`, fullPage: true });
        for (const [suffix, text] of [
          ['organization', 'Limpiar cocina'],
          ['expenses', 'Compra semanal del mercado'],
          ['chat', '¡Buenas! He dejado café recién hecho'],
        ]) {
          const response = await page.goto(
            `https://roomie-hub.vercel.app/homes/${home.id}/${suffix}`,
            { waitUntil: 'networkidle' },
          );
          if (response.status() !== 200) throw new Error('La página demo no devuelve HTTP 200.');
          await expect(page.locator('main')).toContainText(text);
          await page.screenshot({ path: `${output}/seed_${n + 1}_${suffix}.png`, fullPage: true });
        }
        if (errors.length) throw new Error('Errores JavaScript durante la verificación demo.');
        console.log(`PASS Playwright usuario demo ${n + 1}, 390 px: pisos, tareas, gastos y chat.`);
      } finally {
        await context.close();
      }
    }
  } catch {
    // Playwright errors may echo locator.fill input, including the password.
    throw new Error(
      'La verificación Playwright no se completó; revisar las capturas privadas seed_*.png.',
    );
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.some((x) => x !== '--verify-ui')) throw new Error('Uso: seed-demo.mjs [--verify-ui]');
  const release = await lock();
  try {
    const cfg = await config();
    await backupLocal();
    const existingUsers = await listUsers(cfg.admin);
    let state;
    try {
      state = await readState();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      state = {
        namespace,
        project,
        day: new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date()),
        users: [],
        homes: [],
        done: {},
      };
      await saveState(state);
    }
    let value;
    try {
      value = await password();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      if (existingUsers.some((u) => people.some((p) => p.email === u.email)))
        throw new Error('Hay cuentas demo pero faltan sus credenciales locales.');
      value = 'Aa1!' + randomBytes(24).toString('base64url');
      await writeCredentials(value);
    }
    const accounts = [];
    for (const [index, person] of people.entries()) {
      let user = existingUsers.find((u) => u.email === person.email);
      assertAccountContinuity(user, state.users[index]);
      if (user) assertDemoAccount(user, person.email);
      else
        user = (
          await checked(
            cfg.admin.auth.admin.createUser({
              email: person.email,
              password: value,
              email_confirm: true,
              user_metadata: { name: person.name, demo: true, demo_seed: namespace },
            }),
            'crear cuenta demo',
          )
        ).user;
      if (state.users[index] && state.users[index].id !== user.id)
        throw new Error('Identidad demo distinta del manifiesto.');
      const account = { ...person, id: user.id };
      state.users[index] = { ...account };
      await saveState(state);
      account.c = await signIn(cfg, account, value);
      accounts.push(account);
      // Opt out before generating any business event. Never submit external deliveries.
      const prefs = await checked(
        account.c
          .from('notification_preferences')
          .select('category,version,email,push')
          .eq('user_id', user.id),
      );
      for (const category of [
        'tasks',
        'reservations',
        'activities',
        'expenses',
        'community',
        'chat',
      ]) {
        const old = prefs.find((p) => p.category === category);
        if (!old || old.email || old.push)
          await rpc(account.c, 'save_notification_preferences', {
            group_name: category,
            app_enabled: true,
            email_enabled: false,
            push_enabled: false,
            offsets: [60],
            expected_version: old?.version || 0,
          });
      }
    }
    const demoIds = new Set(accounts.map((a) => a.id));
    const before = state.complete ? await snapshot(cfg.admin, state) : null;
    for (const definition of homes) {
      const owner = accounts[definition.members[0]];
      const existing = await checked(
        owner.c.from('homes').select('id,name').eq('name', definition.name),
      );
      if (existing.length > 1) throw new Error('Varios pisos con el mismo nombre demo.');
      const recorded = state.homes.find((h) => h.name === definition.name);
      let home = existing[0];
      if (recorded && (!home || home.id !== recorded.id))
        throw new Error('Piso demo ausente o distinto; no se recrea silenciosamente.');
      if (!home)
        home = {
          id: await rpc(owner.c, 'create_home', {
            home_name: definition.name,
            home_currency: 'EUR',
          }),
          name: definition.name,
        };
      const members = await checked(
        cfg.admin.from('home_members').select('user_id,active').eq('home_id', home.id),
      );
      assertDemoHome(home, members, demoIds);
      if (!recorded) {
        state.homes.push(home);
        await saveState(state);
      }
      await seedHome(state, definition, home, accounts);
    }
    const counts = await snapshot(cfg.admin, state);
    if (before && JSON.stringify(before) !== JSON.stringify(counts))
      throw new Error(
        'Los recuentos han cambiado durante la segunda ejecución; revisar antes de continuar.',
      );
    state.complete = true;
    state.counts = counts;
    await saveState(state);
    console.log(JSON.stringify(counts, null, 2));
    console.log(
      before
        ? 'PASS segunda ejecución: recuentos idénticos; sin duplicados.'
        : 'PASS seed completado: 16 cuentas y 5 pisos demo.',
    );
    console.log(
      'Credenciales guardadas exclusivamente en ~/.local/share/roomiehub-demo/cuentas.md',
    );
    if (args.includes('--verify-ui')) await verifyUi(state, value);
    for (const account of accounts) await account.c.auth.signOut({ scope: 'local' });
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
