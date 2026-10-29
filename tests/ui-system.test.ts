import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { jsx } from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from '../src/components/ui/empty-state';
import { Feedback } from '../src/components/ui/feedback';
import { LoadingSkeleton } from '../src/components/ui/loading-skeleton';
import { CreatePanel } from '../src/components/ui/create-panel';

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
