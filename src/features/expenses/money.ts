export const MAX_MINOR = 1000000000000n;
export function currencyScale(code: string): number {
  if (
    [
      'JPY',
      'KRW',
      'CLP',
      'VND',
      'XAF',
      'XOF',
      'XPF',
      'BIF',
      'DJF',
      'GNF',
      'ISK',
      'KMF',
      'PYG',
      'RWF',
      'UGX',
      'VUV',
    ].includes(code)
  )
    return 0;
  if (['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND'].includes(code)) return 3;
  return ['CLF', 'UYW'].includes(code) ? 4 : 2;
}
export function parseDecimal(value: string, scale: number): bigint {
  const text = value.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new Error('invalid_amount');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale) throw new Error('invalid_amount');
  const n = BigInt(whole) * 10n ** BigInt(scale) + BigInt(fraction.padEnd(scale, '0') || '0');
  if (n > MAX_MINOR) throw new Error('invalid_amount');
  return n;
}
export function decimal(minor: string | bigint | number, scale: number): string {
  const n = BigInt(minor),
    sign = n < 0n ? '-' : '',
    abs = n < 0n ? -n : n;
  if (!scale) return sign + abs.toString();
  const s = abs.toString().padStart(scale + 1, '0');
  return sign + s.slice(0, -scale) + '.' + s.slice(-scale);
}
// Intl formats a decimal STRING: modern ECMA-402 preserves its exact mathematical value.
export function formatMoney(
  minor: string | bigint | number,
  currency: string,
  locale: string,
): string {
  const format = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: currencyScale(currency),
    maximumFractionDigits: currencyScale(currency),
  });
  return (format.format as unknown as (value: string) => string)(
    decimal(minor, currencyScale(currency)),
  );
}
export type SplitMode = 'equal' | 'custom' | 'percentage';
export type ShareInput = { user_id: string; weight: string };
export function splitMoney(total: bigint, mode: SplitMode, people: ShareInput[]) {
  if (
    total <= 0n ||
    total > MAX_MINOR ||
    !people.length ||
    people.length > 100 ||
    new Set(people.map((p) => p.user_id)).size !== people.length
  )
    throw new Error('invalid_split');
  const weights = people.map((p) => ({
    ...p,
    w: mode === 'equal' ? 1n : parseDecimal(p.weight, 0),
  }));
  const denom = weights.reduce((s, p) => s + p.w, 0n);
  if (
    (mode === 'custom' && denom !== total) ||
    (mode === 'percentage' && denom !== 10000n) ||
    denom === 0n
  )
    throw new Error('invalid_split');
  const rows = weights.map((p) => ({
    ...p,
    amount: (total * p.w) / denom,
    remainder: (total * p.w) % denom,
  }));
  let remaining = total - rows.reduce((s, p) => s + p.amount, 0n);
  rows.sort((a, b) =>
    a.remainder > b.remainder
      ? -1
      : a.remainder < b.remainder
        ? 1
        : a.user_id.localeCompare(b.user_id),
  );
  for (const p of rows) {
    if (remaining > 0n) {
      p.amount++;
      remaining--;
    }
  }
  return rows
    .sort((a, b) => a.user_id.localeCompare(b.user_id))
    .map((p) => ({ user_id: p.user_id, amount: p.amount.toString(), weight: p.w.toString() }));
}
export function suggestPayments(balances: { user_id: string; balance: string }[]) {
  if (balances.reduce((sum, b) => sum + BigInt(b.balance), 0n) !== 0n)
    throw new Error('unbalanced_ledger');
  const people = balances
    .filter((b) => BigInt(b.balance) !== 0n)
    .sort((a, b) => a.user_id.localeCompare(b.user_id));
  if (people.length > 8) return greedyPayments(balances);

  // Any settlement graph splits into zero-sum connected components. A component
  // of k people needs at least k-1 transfers; maximizing disjoint zero-sum groups
  // therefore minimizes transfers. At most 256 masks / 3^8 submask steps.
  const size = 1 << people.length;
  const sums = Array<bigint>(size).fill(0n);
  const groups = Array<number>(size).fill(0);
  const chosen = Array<number>(size).fill(0);
  for (let mask = 1; mask < size; mask++) {
    const bit = mask & -mask;
    sums[mask] = sums[mask ^ bit] + BigInt(people[Math.log2(bit)].balance);
    if (sums[mask] !== 0n) continue;
    // Include the first person to avoid enumerating equivalent group orders.
    for (let sub = mask; sub; sub = (sub - 1) & mask) {
      if (sub & bit && sums[sub] === 0n && groups[mask ^ sub] + 1 > groups[mask]) {
        groups[mask] = groups[mask ^ sub] + 1;
        chosen[mask] = sub;
      }
    }
  }
  const result: { from: string; to: string; amount: string }[] = [];
  for (let mask = size - 1; mask; mask ^= chosen[mask]) {
    result.push(...greedyPayments(people.filter((_, i) => chosen[mask] & (1 << i))));
  }
  return result;
}
function greedyPayments(balances: { user_id: string; balance: string }[]) {
  const sort = (a: { amount: bigint; id: string }, b: { amount: bigint; id: string }) =>
    a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.id.localeCompare(b.id);
  const creditors = balances
    .filter((b) => BigInt(b.balance) > 0n)
    .map((b) => ({ id: b.user_id, amount: BigInt(b.balance) }))
    .sort(sort);
  const debtors = balances
    .filter((b) => BigInt(b.balance) < 0n)
    .map((b) => ({ id: b.user_id, amount: -BigInt(b.balance) }))
    .sort(sort);
  const result: { from: string; to: string; amount: string }[] = [];
  let a = 0,
    b = 0;
  while (a < debtors.length && b < creditors.length) {
    const d = debtors[a],
      c = creditors[b],
      n = d.amount < c.amount ? d.amount : c.amount;
    result.push({ from: d.id, to: c.id, amount: n.toString() });
    d.amount -= n;
    c.amount -= n;
    if (!d.amount) a++;
    if (!c.amount) b++;
  }
  return result;
}
export const categories = [
  'groceries',
  'rent',
  'electricity',
  'water',
  'internet',
  'cleaning',
  'transport',
  'leisure',
  'food',
  'home',
  'subscriptions',
  'other',
] as const;
export type Category = (typeof categories)[number];
// Theme-aware inks also keep category colors consistent across chart and list.
export const categoryColors = {
  groceries: 'var(--mint-ink)',
  rent: 'var(--peach-ink)',
  electricity: 'color-mix(in srgb, var(--peach-ink) 65%, var(--mint-ink))',
  water: 'var(--blue-ink)',
  internet: 'color-mix(in srgb, var(--blue-ink) 50%, var(--lavender-ink))',
  cleaning: 'color-mix(in srgb, var(--mint-ink) 50%, var(--blue-ink))',
  transport: 'color-mix(in srgb, var(--mint-ink) 50%, var(--lavender-ink))',
  leisure: 'var(--lavender-ink)',
  food: 'color-mix(in srgb, var(--peach-ink) 50%, var(--rose-ink))',
  home: 'color-mix(in srgb, var(--peach-ink) 50%, var(--lavender-ink))',
  subscriptions: 'var(--rose-ink)',
  other: 'var(--muted)',
} as const satisfies Record<Category, string>;
export const categoryAliases: Partial<Record<Category, string[]>> = {
  groceries: ['mercadona', 'lidl', 'aldi', 'carrefour', 'supermercado', 'grocery'],
  electricity: ['iberdrola', 'endesa', 'electricidad', 'electricity'],
  subscriptions: ['netflix', 'spotify', 'subscription', 'suscripcion'],
  rent: ['alquiler', 'rent'],
  water: ['agua', 'water'],
  internet: ['internet', 'fibra'],
  cleaning: ['limpieza', 'cleaning'],
  transport: ['transporte', 'uber', 'taxi'],
  food: ['cena', 'comida', 'dinner', 'restaurant'],
  home: ['ikea', 'hogar'],
  leisure: ['cine', 'cinema'],
};
export function inferCategory(title: string): Category {
  const s = title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  for (const c of categories) if (categoryAliases[c]?.some((a) => s.includes(a))) return c;
  return 'other';
}

// Percentages use integer hundredths and largest remainders, so the displayed
// shares add up to exactly 100.00%, even for totals beyond Number.MAX_SAFE_INTEGER.
export function summarizeCategories(
  expenses: { category: Category; amount: string | bigint | number }[],
) {
  const totals = new Map<Category, bigint>();
  for (const expense of expenses)
    totals.set(expense.category, (totals.get(expense.category) ?? 0n) + BigInt(expense.amount));
  const total = [...totals.values()].reduce((sum, amount) => sum + amount, 0n);
  if (total === 0n) return { total, categories: [] };
  const rows = [...totals].map(([category, amount]) => ({
    category,
    amount,
    basisPoints: (amount * 10000n) / total,
    remainder: (amount * 10000n) % total,
  }));
  let remaining = 10000n - rows.reduce((sum, row) => sum + row.basisPoints, 0n);
  rows.sort((a, b) =>
    a.remainder > b.remainder
      ? -1
      : a.remainder < b.remainder
        ? 1
        : a.category.localeCompare(b.category),
  );
  for (const row of rows) {
    if (remaining > 0n) {
      row.basisPoints++;
      remaining--;
    }
  }
  rows.sort((a, b) =>
    a.amount > b.amount ? -1 : a.amount < b.amount ? 1 : a.category.localeCompare(b.category),
  );
  return {
    total,
    categories: rows.map(({ category, amount, basisPoints }) => ({
      category,
      amount,
      basisPoints,
    })),
  };
}
