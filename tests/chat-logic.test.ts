import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { textParts, safeLink, attachmentName } from '../src/features/chat/logic';
import { sanitizeChatFile } from '../src/features/chat/files';
import {
  deliveryPayload,
  providerOutcome,
  safePushEndpoint,
  sendEmail,
  validWorkerToken,
  type Delivery,
} from '../src/features/notifications/delivery';
const delivery: Delivery = {
  id: 'delivery-id',
  lease: 'lease',
  channel: 'email',
  user_id: 'recipient',
  notification_id: 'notice-id',
  title: 'Nueva valoración',
  body: 'Abre RoomieHub para ver los detalles.',
  url: '/homes/11111111-1111-4111-8111-111111111111/community',
  event_at: null,
  subscription: null,
};
test('chat leaves HTML as plain text; links restrict schemes and credential URLs', () => {
  assert.equal(safeLink('javascript:alert(1)'), null);
  assert.equal(safeLink('https://user:pass@example.com'), null);
  const parts = textParts('<img onerror=alert(1)> 😃\nhttps://example.com?q=one');
  assert.equal(parts[0].href, null);
  assert.equal(parts[1].href, 'https://example.com/?q=one');
  assert.ok(!attachmentName('../bad\0/name.html').includes('/'));
});
test('chat image verification decodes and re-encodes real pixels', async () => {
  const input = await sharp({ create: { width: 32, height: 32, channels: 3, background: 'red' } })
    .png()
    .toBuffer();
  const file = await sanitizeChatFile(input, 'image/png', 'photo.png');
  assert.equal(file.mime, 'image/webp');
  assert.equal((await sharp(file.bytes).metadata()).exif, undefined);
  await assert.rejects(sanitizeChatFile(input, 'image/jpeg', 'fake.jpg'));
  await assert.rejects(
    sanitizeChatFile(Buffer.from('<svg onload="alert(1)">'), 'image/png', 'fake.png'),
  );
});
test('chat rejects executables, active documents, oversized and invalid text', async () => {
  for (const [data, mime] of [
    ['MZ executable', 'text/plain'],
    ['#!/bin/sh', 'text/plain'],
    ['<html>script</html>', 'text/plain'],
    ['abc', 'application/x-msdownload'],
    ['fake', 'application/pdf'],
  ])
    await assert.rejects(sanitizeChatFile(Buffer.from(data), mime, 'file'));
  await assert.rejects(
    sanitizeChatFile(new Uint8Array(10 * 1024 * 1024 + 1), 'text/plain', 'big.txt'),
  );
  await assert.rejects(sanitizeChatFile(new Uint8Array([255, 254]), 'text/plain', 'bad.txt'));
  const valid = await sanitizeChatFile(
    Buffer.from('plain text 😄\nsecond line'),
    'text/plain',
    'readme.txt',
  );
  assert.equal(valid.mime, 'text/plain');
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.catalog.set(
    PDFName.of('OpenAction'),
    doc.context.obj({ S: PDFName.of('JavaScript'), JS: PDFString.of('app.alert(1)') }),
  );
  await assert.rejects(sanitizeChatFile(await doc.save(), 'application/pdf', 'active.pdf'));
});
test('plain PDF is supported and metadata stripped', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setAuthor('Private identity');
  const file = await sanitizeChatFile(await doc.save(), 'application/pdf', 'document.pdf');
  assert.equal((await PDFDocument.load(file.bytes)).getAuthor(), '');
});
test('worker auth and push endpoints reject untrusted requests', () => {
  const secret = 'a'.repeat(40);
  assert.equal(validWorkerToken(`Bearer ${secret}`, secret), true);
  assert.equal(validWorkerToken('Bearer wrong', secret), false);
  assert.equal(validWorkerToken('Bearer undefined', undefined), false);
  for (const endpoint of [
    'http://127.0.0.1/x',
    'https://fcm.googleapis.com.evil.test/x',
    'https://fcm.googleapis.com@evil.test/x',
    'https://fcm.googleapis.com:444/x',
  ])
    assert.equal(safePushEndpoint(endpoint), false);
  assert.equal(safePushEndpoint('https://fcm.googleapis.com/fcm/send/token'), true);
});
test('provider responses are explicit retry, permanent failure and expired subscription', () => {
  assert.equal(providerOutcome(410).outcome, 'expired');
  assert.equal(providerOutcome(429).outcome, 'retry');
  assert.equal(providerOutcome(503).outcome, 'retry');
  assert.equal(providerOutcome(401).outcome, 'failed');
  assert.equal(providerOutcome().outcome, 'retry');
});
test('email adapter calls provider with stable idempotency and minimal anonymous payload', async () => {
  let seen: RequestInit | undefined;
  const transport: typeof fetch = async (input, init) => {
    assert.equal(input, 'https://api.resend.com/emails');
    seen = init;
    return new Response('{}', { status: 200 });
  };
  assert.equal(
    (
      await sendEmail(
        delivery,
        'test@example.test',
        {
          key: 'test-key',
          from: 'RoomieHub <test@example.test>',
          origin: 'https://roomie.example',
        },
        transport,
      )
    ).outcome,
    'sent',
  );
  assert.equal(new Headers(seen?.headers).get('Idempotency-Key'), delivery.id);
  const body = JSON.parse(String(seen?.body));
  assert.equal(body.to[0], 'test@example.test');
  assert.ok(body.text.includes('https://roomie.example/homes/'));
  assert.ok(!String(seen?.body).includes('author'));
  const failed: typeof fetch = async () => new Response('{}', { status: 429 });
  assert.equal(
    (
      await sendEmail(
        delivery,
        'test@example.test',
        { key: 'key', from: 'from', origin: 'https://roomie.example' },
        failed,
      )
    ).outcome,
    'retry',
  );
  assert.equal(deliveryPayload({ ...delivery, url: '//evil.test' }).url, '/homes');
});
