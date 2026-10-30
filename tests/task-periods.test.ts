import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { groupTaskPeriods, TaskPeriodHeading } from '../src/features/organization/task-periods';

test('presentation groups distinct recurrence periods without losing or mutating occurrences', () => {
  const rows = [
    { id: 'weekly-a', period_start: '2026-09-14', period_end: '2026-09-21' },
    { id: 'daily', period_start: '2026-09-14', period_end: '2026-09-15' },
    { id: 'weekly-b', period_start: '2026-09-14', period_end: '2026-09-21' },
    { id: 'current', period_start: '2026-10-30', period_end: '2026-10-31' },
  ];
  const original = structuredClone(rows),
    groups = groupTaskPeriods(rows);
  assert.deepEqual(
    groups.map((g) => g.items.map((row) => row.id)),
    [['weekly-a', 'weekly-b'], ['daily'], ['current']],
  );
  assert.equal(new Set(groups.flatMap((g) => g.items.map((row) => row.id))).size, rows.length);
  assert.deepEqual(rows, original);
  assert.deepEqual(groupTaskPeriods([]), []);
});

test('visible period dates respect exclusive end, one-day periods, leap day and locale', () => {
  for (const locale of ['es', 'en'] as const) {
    const day = renderToStaticMarkup(
      createElement(TaskPeriodHeading, { start: '2026-10-30', end: '2026-10-31', locale }),
    );
    assert.equal((day.match(/<time\b/g) ?? []).length, 1);
    assert.ok(day.includes('dateTime="2026-10-30"'));
    const week = renderToStaticMarkup(
      createElement(TaskPeriodHeading, { start: '2024-02-26', end: '2024-03-04', locale }),
    );
    assert.ok(week.includes('dateTime="2024-02-26"'));
    assert.ok(week.includes('dateTime="2024-03-03"'));
    assert.ok(!week.includes('dateTime="2024-03-04"'));
  }
});
