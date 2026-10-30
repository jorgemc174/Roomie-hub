import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adjacentDestination, swipeDirection } from '../src/lib/swipe-navigation';
const sample = { startX: 200, startY: 200, endX: 90, endY: 208, elapsed: 250, width: 390 };
test('a deliberate horizontal swipe selects the next or previous tab', () => {
  assert.equal(swipeDirection(sample), 1);
  assert.equal(swipeDirection({ ...sample, startX: 90, endX: 200 }), -1);
});
test('vertical scrolling, short drags, slow selection and browser-back edges do not navigate', () => {
  for (const change of [
    { endY: 380 },
    { endX: 170 },
    { elapsed: 1600 },
    { startX: 8 },
    { startX: 382 },
  ])
    assert.equal(swipeDirection({ ...sample, ...change }), 0);
});
test('swipes never wrap or invent a route outside the current navigation', () => {
  const links = [
    { href: '/tasks', current: true },
    { href: '/shopping', current: false },
  ];
  assert.equal(adjacentDestination(links, 1), '/shopping');
  assert.equal(adjacentDestination(links, -1), null);
  assert.equal(adjacentDestination(links, 0), null);
  assert.equal(
    adjacentDestination(
      links.map((link) => ({ ...link, current: false })),
      1,
    ),
    null,
  );
});
