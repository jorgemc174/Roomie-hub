import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../src/components/ui/empty-state';
import { Feedback } from '../src/components/ui/feedback';
import { LoadingSkeleton } from '../src/components/ui/loading-skeleton';
import { CreatePanel } from '../src/components/ui/create-panel';
import { OptionsMenu } from '../src/components/ui/options-menu';
import { organizationMessages } from '../src/features/organization/messages';
import { CommunityRanking } from '../src/features/community/ranking';
import { communityMessages } from '../src/features/community/messages';
import type { CommunityBalance } from '../src/features/community/models';
import { PendingOccurrence } from '../src/features/expenses/pending-occurrence';
import { expenseMessages } from '../src/features/expenses/messages';
import { formatMoney } from '../src/features/expenses/money';
import type { Occurrence } from '../src/features/expenses/models';

test('empty states explain the next step using a real navigable action', () => {
  const html = renderToStaticMarkup(
    createElement(EmptyState, {
      title: 'No lists yet',
      description: 'Create a list to start shopping.',
      action: createElement(
        'a',
        { href: '/homes/test/organization?tab=shopping&create=list' },
        'Create list',
      ),
    }),
  );
  assert.ok(html.includes('<h2>No lists yet</h2>'));
  assert.ok(html.includes('href="/homes/test/organization?tab=shopping&amp;create=list"'));
  assert.ok(html.includes('aria-hidden="true"'));
});
test('errors and confirmations expose the appropriate announcement priority', () => {
  assert.ok(
    renderToStaticMarkup(jsx(Feedback, { kind: 'error', children: 'Try again' })).includes(
      'role="alert"',
    ),
  );
  assert.ok(
    renderToStaticMarkup(jsx(Feedback, { kind: 'success', children: 'Saved' })).includes(
      'role="status"',
    ),
  );
});
test('loading exposes one busy status and hides decorative placeholders', () => {
  const html = renderToStaticMarkup(createElement(LoadingSkeleton, { label: 'Loading your home' }));
  assert.equal((html.match(/role="status"/g) ?? []).length, 1);
  assert.ok(html.includes('aria-busy="true"'));
  assert.ok(html.includes('Loading your home'));
  assert.ok(html.includes('aria-hidden="true"'));
});
test('deep-linked creation opens the form while retaining a close action', () => {
  const html = renderToStaticMarkup(
    jsx(CreatePanel, {
      title: 'Create expense',
      closeLabel: 'Close form',
      defaultOpen: true,
      children: createElement('input', { name: 'amount', 'aria-label': 'Amount' }),
    }),
  );
  assert.ok(html.includes('open=""'));
  assert.ok(html.includes('<summary>'));
  assert.ok(html.includes('Close form'));
  assert.ok(html.includes('type="button"'));
});

test('pending recurring expenses expose an exact summary and a closed confirmation retaining its form', () => {
  const occurrence: Occurrence = {
    id: 'due',
    home_id: 'test',
    recurring_id: 'rent',
    period_date: '2026-11-01',
    recurrence_kind: 'fixed',
    status: 'pending',
    expense_id: null,
    created_at: '',
    updated_at: '',
    template: {
      title: 'Rent',
      amount: '1000000000000',
      date: '2026-11-01',
      payer: 'me',
      category: 'rent',
      split_mode: 'equal',
      participants: [{ user_id: 'me', weight: '1' }],
    },
  };
  for (const locale of ['es', 'en'] as const) {
    const t = expenseMessages(locale);
    for (const recurrence_kind of ['fixed', 'variable'] as const) {
      const html = renderToStaticMarkup(
        jsx(PendingOccurrence, {
          occurrence: { ...occurrence, recurrence_kind },
          currency: 'JPY',
          locale,
          children: createElement('input', { name: 'amount', defaultValue: 'Draft' }),
        }),
      );
      assert.ok(html.startsWith('<details class="panel" id="occurrence-due">'));
      assert.ok(!html.includes('open=""'));
      const summary = html.slice(0, html.indexOf('</summary>'));
      assert.ok(summary.includes('Rent'));
      assert.ok(
        summary.includes(
          new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
            new Date('2026-11-01T12:00:00Z'),
          ),
        ),
      );
      assert.ok(
        summary.includes(
          recurrence_kind === 'variable' ? t.variable : formatMoney('1000000000000', 'JPY', locale),
        ),
      );
      assert.ok(summary.includes(t.confirm));
      assert.ok(html.includes('value="Draft"'));
      assert.ok(html.indexOf('name="amount"') > html.indexOf('</summary>'));
    }
  }
});

test('options use a labelled native disclosure with links and independent confirmation forms', () => {
  for (const locale of ['es', 'en'] as const) {
    const t = organizationMessages(locale);
    const html = renderToStaticMarkup(
      jsx(OptionsMenu, {
        label: t.options,
        children: [
          createElement(
            'a',
            { key: 'link', href: '/homes/test/organization?tab=absences' },
            t.absences,
          ),
          createElement(
            'details',
            { key: 'delete' },
            createElement('summary', null, t.delete),
            createElement(
              'form',
              { action: '/delete', method: 'post' },
              createElement('button', { type: 'submit' }, t.confirmDelete),
            ),
          ),
          createElement(
            'form',
            { key: 'edit', action: '/edit', method: 'post' },
            createElement('input', { name: 'name', defaultValue: 'Draft', 'aria-label': t.name }),
            createElement('button', { type: 'submit' }, t.save),
          ),
        ],
      }),
    );
    assert.ok(html.startsWith('<details class="ui-options-menu">'));
    assert.ok(html.includes(`aria-label="${t.options}" aria-expanded="false"`));
    const controls = html.match(/aria-controls="([^"]+)"/)?.[1];
    assert.ok(controls && html.includes(`id="${controls}"`));
    assert.ok(html.includes('<span aria-hidden="true">⋯</span>'));
    assert.ok(!html.includes('role="menu'));
    assert.ok(!html.includes('open=""'));
    assert.ok(html.includes(t.confirmDelete));
    assert.ok(html.includes('value="Draft"'));
    assert.equal((html.match(/<form\b/g) ?? []).length, 2);
    assert.ok(html.indexOf('</form>') < html.lastIndexOf('<form'));
  }
});

test('ranking table lists every active member once, ordered by negatives, positives then UUID', () => {
  const row = (
    id: string,
    negatives: number,
    positives: number,
    active = true,
  ): CommunityBalance => ({
    user_id: id,
    user_name: `Participant ${id}`,
    active,
    negative_effective: negatives,
    negative_history: negatives + 3,
    positive_available: positives,
    positive_history: positives + 9,
    positive_consumed: 9,
    credits: 0,
    pending_punishments: id === 'd' ? 2 : 0,
  });
  const balances = [
    row('d', 2, 20),
    row('c', 1, 0),
    row('b', 1, 3),
    row('a', 1, 3),
    row('former', 0, 90, false),
  ];
  for (const locale of ['es', 'en'] as const) {
    const t = communityMessages(locale);
    const html = renderToStaticMarkup(
      createElement(CommunityRanking, {
        homeId: 'test',
        locale,
        balances,
        currentUserId: 'a',
        avatars: { a: '/avatar.webp' },
      }),
    );
    assert.ok(html.includes(`<caption class="sr-only">${t.ranking}</caption>`));
    assert.ok(html.includes('aria-describedby="ranking-order"'));
    assert.ok(html.includes(t.rankingOrder));
    const head = html.slice(html.indexOf('<thead>'), html.indexOf('</thead>'));
    assert.equal((head.match(/scope="col"/g) ?? []).length, 5);
    for (const label of [
      t.position,
      t.person,
      t.positives,
      t.negatives,
      t.rankingPunishments,
      t.pending,
    ]) {
      assert.ok(head.includes(label));
    }
    assert.ok(head.includes(t.rankingPositivesHelp));
    assert.ok(head.includes(t.effective));
    const body = html.slice(html.indexOf('<tbody>'), html.indexOf('</tbody>'));
    const rows = Array.from(body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g), (match) => match[1]);
    assert.equal(rows.length, 4);
    assert.deepEqual(
      rows.map((value) => value.match(/person=([^"]+)/)?.[1]),
      ['a', 'b', 'c', 'd'],
    );
    for (const [index, value] of rows.entries()) {
      assert.ok(value.includes(`<td>${index + 1}</td>`));
      assert.ok(value.includes('<th scope="row">'));
      assert.ok(value.includes('/community?tab=points&amp;person='));
    }
    assert.ok(!body.includes('Participant former'));
    assert.equal((body.match(/class="is-current"/g) ?? []).length, 1);
    assert.ok(rows[0].includes(t.you));
    assert.ok(rows[0].includes('src="/avatar.webp" alt=""'));
    assert.ok(rows[0].includes('>3 <span class="ranking-history">(12)</span>'));
    assert.ok(rows[0].includes('<td>1</td><td>—</td>'));
    assert.ok(rows[3].includes('<td>2</td><td>2</td>'));
  }
});
