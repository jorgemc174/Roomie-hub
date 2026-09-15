import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currencies, currencyOptions, currencyLabel, validCurrency } from '../src/lib/currencies';
test('catalogue contains all requested currencies, with EUR first and no duplicates', () => {
  const required =
    'EUR USD GBP JPY CHF CAD AUD NZD CNY HKD SGD KRW INR MXN BRL ARS CLP COP PEN SEK NOK DKK PLN CZK HUF RON TRY AED SAR ZAR'.split(
      ' ',
    );
  for (const code of required) assert.ok(currencies.includes(code));
  assert.equal(currencies[0], 'EUR');
  assert.equal(new Set(currencies).size, currencies.length);
  for (const code of currencies) assert.ok(validCurrency(code));
});
test('format validation is separate from the curated catalogue', () => {
  for (const code of ['EUR', 'BHD', 'JPY']) assert.ok(validCurrency(code));
  for (const code of ['eur', 'EUR\n', 'EU', 'EURO', 'E1R', '€UR', ' EUR'])
    assert.equal(validCurrency(code), false);
  assert.ok(currencyOptions('BHD').includes('BHD'));
  assert.equal(currencyOptions('eur').includes('eur'), false);
  assert.match(currencyLabel('JPY', 'es'), /^JPY — /);
  assert.notEqual(currencyLabel('JPY', 'es'), currencyLabel('JPY', 'en'));
});
