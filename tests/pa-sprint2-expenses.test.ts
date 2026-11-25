import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { createElement, type ReactNode } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as money from '../src/features/expenses/money';
import * as messages from '../src/features/expenses/messages';
import * as validation from '../src/features/expenses/validation';
import * as receiptLimits from '../src/features/expenses/receipt-limits';
import { normalizeCalendar } from '../src/features/calendar/logic';
import { expenseNames } from '../src/features/calendar/queries';
import type { ExpenseBody, Occurrence, Recurring } from '../src/features/expenses/models';

const { checkExpense, limitDecimals, formatPercent, splitMismatch } = validation;
const draft = (over: Partial<validation.ExpenseDraft> = {}): validation.ExpenseDraft => ({
  title: 'Factura de luz',
  amount: '60.00',
  variable: false,
  mode: 'equal',
  participants: ['a', 'b'],
  shares: {},
  scale: 2,
  ...over,
});
// Intl uses non-breaking spaces before % and €; compare with plain spaces.
const plain = (s: string) => s.replace(/[  ]/g, ' ');

test('PA 2337: blank concept and zero or negative amounts are field errors', () => {
  assert.equal(checkExpense(draft({ title: '   ' })).title, 'required');
  assert.equal(checkExpense(draft({ amount: '0' })).amount, 'positive');
  assert.equal(checkExpense(draft({ amount: '0.00' })).amount, 'positive');
  assert.equal(checkExpense(draft({ amount: '-15.50' })).amount, 'positive');
  assert.equal(checkExpense(draft({ amount: '' })).amount, 'positive');
  assert.equal(checkExpense(draft({ amount: 'abc' })).amount, 'format');
  assert.deepEqual(checkExpense(draft()), {});
  const es = messages.expenseMessages('es');
  assert.equal(es.conceptRequired, 'El concepto es obligatorio');
  assert.equal(es.amountPositive, 'El importe debe ser mayor que 0');
});

test('PA 2339: no participants is reported with the literal message', () => {
  assert.equal(checkExpense(draft({ participants: [] })).participants, 'required');
  assert.equal(
    messages.expenseMessages('es').participantsRequired,
    'Debe haber al menos un participante seleccionado para repartir el gasto',
  );
});

test('PA 2356/2357/2358/2360/2362: split sums against the total or 100 %', () => {
  const custom = (amount: string, shares: Record<string, string>) =>
    checkExpense(draft({ amount, mode: 'custom', participants: Object.keys(shares), shares }));
  assert.deepEqual(custom('100.00', { a: '50.00', b: '30.00', c: '20.00' }).sum, {
    mode: 'custom',
    sum: 10000n,
    target: 10000n,
  });
  const short = custom('50.00', { a: '20.00', b: '15.00' });
  assert.deepEqual(short.sum, { mode: 'custom', sum: 3500n, target: 5000n });
  assert.equal(splitMismatch(short), true);
  const over = custom('40.00', { a: '25.00', b: '25.00' });
  assert.deepEqual(over.sum, { mode: 'custom', sum: 5000n, target: 4000n });
  // An empty share counts as 0.00: participant B is kept with nothing to pay.
  const zero = custom('30.00', { a: '30.00', b: '' });
  assert.equal(splitMismatch(zero), false);
  assert.deepEqual(
    money.splitMoney(3000n, 'custom', [
      { user_id: 'a', weight: '3000' },
      { user_id: 'b', weight: validation.shareValue('') },
    ]),
    [
      { user_id: 'a', amount: '3000', weight: '3000' },
      { user_id: 'b', amount: '0', weight: '0' },
    ],
  );
  const pct = (shares: Record<string, string>) =>
    checkExpense(
      draft({ amount: '150.00', mode: 'percentage', participants: Object.keys(shares), shares }),
    );
  assert.equal(pct({ a: '40', b: '40' }).sum?.sum, 8000n);
  assert.equal(pct({ a: '60', b: '50' }).sum?.sum, 11000n);
  assert.equal(splitMismatch(pct({ a: '60', b: '40' })), false);
  assert.equal(plain(formatPercent(8000n, 'es')), '80 %');
  assert.equal(plain(formatPercent(11000n, 'en')), '110%');
});

test('PA 2360: share and amount fields keep at most the currency decimals', () => {
  assert.equal(limitDecimals('15.005', 2), '15.00');
  assert.equal(limitDecimals('15,999', 2), '15,99');
  assert.equal(limitDecimals('1.2.3', 2), '1.23');
  assert.equal(limitDecimals('12a', 2), '12');
  assert.equal(limitDecimals('12.5', 0), '125');
  assert.equal(limitDecimals('-15.505', 2), '-15.50');
});

type Component = (props: Record<string, unknown>) => ReactNode;
async function expenseForm() {
  const { outputText } = ts.transpileModule(
    await readFile('src/features/expenses/expense-form.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  );
  const exports: Record<string, Component> = {};
  const dependencies: Record<string, unknown> = {
    react: React,
    'react/jsx-runtime': jsxRuntime,
    'lucide-react': { LoaderCircle: () => null },
    '@/components/ui/use-retained-form': { useRetainedForm: () => () => undefined },
    '@/components/ui/form-feedback': { FormFeedback: () => null },
    './actions': { financeAction: async () => ({}) },
    '@/lib/supabase/browser': {},
    './receipt-limits': receiptLimits,
    './messages': messages,
    './money': money,
    './validation': validation,
  };
  vm.runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      if (!(name in dependencies)) throw new Error(`Unexpected dependency ${name}`);
      return dependencies[name];
    },
  });
  return exports.ExpenseForm;
}
const members = [
  { id: '00000000-0000-4000-8000-00000000000a', name: 'Ana' },
  { id: '00000000-0000-4000-8000-00000000000b', name: 'Bea' },
];
async function render(initial: ExpenseBody, locale: 'es' | 'en' = 'es') {
  const Form = await expenseForm();
  return plain(
    renderToStaticMarkup(
      createElement(Form, {
        homeId: 'h',
        id: '00000000-0000-4000-8000-000000000001',
        currency: 'EUR',
        locale,
        today: '2026-11-25',
        userId: members[0].id,
        members,
        initial,
      }),
    ),
  );
}
const body = (
  amount: string,
  split_mode: ExpenseBody['split_mode'],
  weights: string[],
): ExpenseBody => ({
  title: 'Compra',
  amount,
  date: '2026-11-25',
  payer: members[0].id,
  category: 'groceries',
  split_mode,
  participants: weights.map((weight, i) => ({ user_id: members[i].id, weight })),
});
const submitDisabled = (html: string) =>
  /<button type="submit" class="button" disabled=""/.test(html);

test('PA 2356: the form shows the sum indicator and enables saving when it matches', async () => {
  const html = await render(body('10000', 'custom', ['5000', '5000']));
  assert.match(html, /Suma de las partes: 100,00 € de 100,00 €/);
  assert.match(html, /La suma de las partes coincide con el total del gasto\./);
  assert.equal(submitDisabled(html), false);
});

test('PA 2357: a short custom split shows sum, total and highlighted missing amount', async () => {
  const html = await render(body('5000', 'custom', ['2000', '1500']));
  assert.match(
    html,
    /La suma de las partes \(35,00 €\) no coincide con el total del gasto \(50,00 €\)\. Faltan <strong class="split-diff">15,00 €<\/strong> por asignar/,
  );
  assert.equal(submitDisabled(html), true);
});

test('PA 2358: an excessive custom split shows the excess and disables saving', async () => {
  const html = await render(body('4000', 'custom', ['2500', '2500']));
  assert.match(html, /La suma introducida supera el total por <strong class="split-diff">10,00 €/);
  assert.equal(submitDisabled(html), true);
  const en = await render(body('4000', 'custom', ['2500', '2500']), 'en');
  assert.match(en, /The entered sum exceeds the total by <strong class="split-diff">€10\.00/);
});

test('PA 2362: percentages other than 100 % show the current sum and disable saving', async () => {
  const html = await render(body('15000', 'percentage', ['4000', '4000']));
  assert.match(
    html,
    /La suma de los porcentajes debe ser exactamente 100%\. Actual: <strong class="split-diff">80 %<\/strong>/,
  );
  assert.equal(submitDisabled(html), true);
});

test('PA 2339: with no participant selected the form shows the explicit alert', async () => {
  const html = await render(body('6000', 'equal', []));
  assert.match(
    html,
    /role="alert">Debe haber al menos un participante seleccionado para repartir el gasto</,
  );
});

test('PA 2806: expense events list payer and participants by name', async () => {
  const template = body('6000', 'equal', ['1', '1']);
  const recurring = {
    id: 'r',
    active: true,
    next_date: '2026-11-26',
    template,
  } as Recurring;
  const pending = {
    id: 'p',
    status: 'pending',
    period_date: '2026-11-26',
    template: { ...template, payer: members[1].id },
  } as Occurrence;
  const events = normalizeCalendar(
    {
      homeId: 'h',
      tasks: [],
      reservations: [],
      activities: [],
      members: [],
      recurring: [recurring],
      occurrences: [pending],
      names: { [members[0].id]: 'Ana', [members[1].id]: 'Bea' },
    },
    '2026-11-25T10:00:00Z',
  );
  assert.deepEqual(
    events.map((e) => [e.id, e.names, e.people.length]),
    [
      ['pending:p', ['Bea', 'Ana'], 2],
      ['recurring:r:2026-11-26', ['Ana', 'Bea'], 2],
    ],
  );
  // Former members are resolved from the home's expense snapshots, only when needed.
  let calls = 0;
  const db = {
    rpc: async () => {
      calls++;
      return {
        data: [{ user_id: members[1].id, name: 'Bea', balance: '0', active: false }],
        error: null,
      };
    },
  } as unknown as Parameters<typeof expenseNames>[0];
  const active = [{ user_id: members[0].id, profiles: { name: 'Ana' } }];
  assert.deepEqual(await expenseNames(db, 'h', active, [recurring]), {
    [members[0].id]: 'Ana',
    [members[1].id]: 'Bea',
  });
  assert.equal(calls, 1);
  await expenseNames(db, 'h', active, [{ template: { ...template, participants: [] } }]);
  assert.equal(calls, 1);
});
