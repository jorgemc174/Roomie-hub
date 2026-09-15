/** Curated ISO 4217 catalogue. Extend here; the database validates format, not this list. */
export const currencies: readonly string[] = [
  'EUR',
  'USD',
  'GBP',
  'JPY',
  'CHF',
  'CAD',
  'AUD',
  'NZD',
  'CNY',
  'HKD',
  'SGD',
  'KRW',
  'INR',
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  'SEK',
  'NOK',
  'DKK',
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'TRY',
  'AED',
  'SAR',
  'ZAR',
];
export function validCurrency(code: string) {
  return code.length === 3 && /^[A-Z]{3}$/.test(code);
}
/** Preserve valid currencies written by an API even before adding them to the catalogue. */
export function currencyOptions(current = 'EUR') {
  return validCurrency(current) && !currencies.includes(current)
    ? [...currencies, current]
    : currencies;
}
export function currencyLabel(code: string, locale: string) {
  const name = new Intl.DisplayNames([locale], { type: 'currency' }).of(code);
  return name && name !== code ? `${code} — ${name}` : code;
}
