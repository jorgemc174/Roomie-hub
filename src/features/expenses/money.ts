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
