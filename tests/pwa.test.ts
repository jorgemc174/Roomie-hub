import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
test('service worker never caches auth/private requests, never queues writes, and opens only same-origin targets', async () => {
  const listeners: Record<string, (event: unknown) => void> = {};
  const shown: unknown[] = [];
  const self = {
    location: { origin: 'https://roomie.example' },
    addEventListener: (name: string, fn: (event: unknown) => void) => {
      listeners[name] = fn;
    },
    registration: {
      showNotification: async (...args: unknown[]) => {
        shown.push(args);
      },
    },
  };
  const context = vm.createContext({
    self,
    URL,
    Response,
    Date,
    fetch: async () => new Response('online'),
  });
  vm.runInContext(await readFile('public/sw.js', 'utf8'), context);
  assert.equal(
    vm.runInContext("safeTarget('/homes/abc/chat')", context),
    'https://roomie.example/homes/abc/chat',
  );
  assert.equal(
    vm.runInContext("safeTarget('https://roomie.example/homes/abc/chat')", context),
    'https://roomie.example/homes/abc/chat',
  );
  for (const url of [
    'https://evil.test',
    '//evil.test',
    'javascript:alert(1)',
    '/homes/\\evil.test',
  ])
    assert.equal(
      vm.runInContext(`safeTarget(${JSON.stringify(url)})`, context),
      'https://roomie.example/notifications',
    );
  for (const [url, method, mode] of [
    ['/auth/callback', 'POST', 'cors'],
    ['/homes/abc/chat', 'POST', 'cors'],
    ['/homes/abc/chat?_rsc=1', 'GET', 'cors'],
    ['/api/private', 'GET', 'cors'],
  ]) {
    let intercepted = false;
    listeners.fetch({
      request: { url: `https://roomie.example${url}`, method, mode },
      respondWith: () => {
        intercepted = true;
      },
    });
    assert.equal(intercepted, false);
  }
  let work: Promise<unknown> | undefined;
  listeners.push({
    data: { json: () => ({ id: 'past', title: 'Reminder', eventAt: '2000-01-01' }) },
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  assert.equal(shown.length, 0);
  listeners.push({
    data: {
      json: () => ({
        id: 'new',
        title: 'Generic rating',
        body: 'Open app',
        url: '/homes/abc/chat',
      }),
    },
    waitUntil: (p: Promise<unknown>) => {
      work = p;
    },
  });
  await work;
  assert.equal(shown.length, 1);
});
