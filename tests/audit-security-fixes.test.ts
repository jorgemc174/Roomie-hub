import test from 'node:test';
import assert from 'node:assert/strict';
import * as cryptoModule from 'node:crypto';
import sharp from 'sharp';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { receiptExtension, receiptFile } from '../src/features/expenses/receipts';
import { sanitizeRatingPhoto } from '../src/features/community/photo';
import { sanitizeChatFile } from '../src/features/chat/files';
import { validUuid } from '../src/features/chat/logic';
import { chatMessages } from '../src/features/chat/messages';
import { serverModule } from './helpers/server-module';

const homeId = '11111111-1111-4111-8111-111111111111';
const itemId = '22222222-2222-4222-8222-222222222222';
const fileId = '33333333-3333-4333-8333-333333333333';

test('B2: photo route re-encodes direct Storage uploads instead of serving EXIF or executable bytes', async () => {
  let bytes = await sharp({ create: { width: 24, height: 24, channels: 3, background: 'red' } })
    .webp()
    .withExif({ IFD0: { Artist: 'Private GPS identity' } })
    .toBuffer();
  const events: string[] = [];
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    is() {
      return this;
    },
    async maybeSingle() {
      return { data: { attachment_path: 'direct.webp' }, error: null };
    },
  };
  const { GET } = await serverModule<{
    GET: (
      r: Request,
      c: { params: Promise<{ homeId: string; ratingId: string }> },
    ) => Promise<Response>;
  }>('src/app/(workspace)/homes/[homeId]/community/photo/[ratingId]/route.ts', {
    '@/lib/data': {
      getHome: async () => {
        events.push('membership');
      },
      requireUser: async () => ({
        db: {
          from: () => query,
          storage: {
            from: () => ({
              download: async () => {
                events.push('download');
                return {
                  data: new Blob([new Uint8Array(bytes)], { type: 'image/webp' }),
                  error: null,
                };
              },
            }),
          },
        },
      }),
    },
    'next/navigation': {
      notFound: () => {
        throw new Error('not_found');
      },
    },
    '@/features/community/photo': { sanitizeRatingPhoto },
  });
  const invoke = () =>
    GET(new Request('https://roomie.test/photo'), {
      params: Promise.resolve({ homeId, ratingId: itemId }),
    });
  const response = await invoke();
  const clean = Buffer.from(await response.arrayBuffer());
  assert.equal((await sharp(clean).metadata()).format, 'webp');
  assert.equal((await sharp(clean).metadata()).exif, undefined);
  assert.equal(clean.includes(Buffer.from('Private GPS identity')), false);
  assert.deepEqual(events, ['membership', 'download']);
  assert.match(response.headers.get('Cache-Control')!, /no-store/);
  bytes = Buffer.from('MZ executable with a WebP content type');
  await assert.rejects(invoke(), /not_found/);
});

test('B2: receipts reject truncated PDFs, trailing payloads and active or embedded content', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  const pdf = await doc.save({ useObjectStreams: false });
  const check = (bytes: Uint8Array) => receiptExtension('application/pdf', bytes.length, bytes);
  assert.equal(await check(pdf), 'pdf');
  assert.equal(await check(Buffer.from('%PDF-1.7')), null);
  assert.equal(await check(pdf.subarray(0, pdf.length - 10)), null);
  assert.equal(await check(Buffer.concat([pdf, Buffer.from('\nMZ payload')])), null);
  for (const name of [
    'JavaScript',
    'JS',
    'OpenAction',
    'AA',
    'Launch',
    'EmbeddedFile',
    'RichMedia',
    'XFA',
  ]) {
    const active = await PDFDocument.create();
    active.addPage();
    active.catalog.set(PDFName.of(name), PDFString.of('active payload'));
    // Default save compresses the catalog; byte-string matching alone cannot catch it.
    assert.equal(await check(await active.save()), null, name);
  }
  const activeName = Buffer.from(
    Buffer.from(pdf).toString('latin1').replace('/Type /Catalog', '/Type /Catalog /J#53 (alert)'),
  );
  assert.equal(await check(activeName), null);
  await assert.rejects(sanitizeChatFile(Buffer.from('%PDF-1.7'), 'application/pdf', 'bad.pdf'));
});

test('B2: chat checks membership, quota, count and byte limits before reading/decoding', async (t) => {
  for (const scenario of [
    'unauthorized',
    'rate_limited',
    'oversized_image',
    'oversized_pdf',
    'too_many',
    'success',
  ]) {
    await t.test(scenario, async () => {
      const events: string[] = [];
      const db = {
        rpc: async (operation: string) => {
          events.push(operation);
          return {
            data: operation === 'prepare_chat_attachment' ? 'file-path' : null,
            error:
              operation === 'authorize_chat_uploads' &&
              ['unauthorized', 'rate_limited'].includes(scenario)
                ? { message: scenario }
                : null,
          };
        },
        storage: { from: () => ({ info: async () => ({ data: {} }) }) },
      };
      const { chatCommand } = await serverModule<{
        chatCommand: (
          home: string,
          op: string,
          f: FormData,
        ) => Promise<{ ok?: string; error?: string }>;
      }>('src/features/chat/actions.ts', {
        'node:crypto': cryptoModule,
        'next/navigation': { unstable_rethrow: () => {} },
        '@/lib/data': { requireUser: async () => ({ db }) },
        '@/lib/i18n/server': { i18n: async () => ({ locale: 'es' }) },
        './messages': { chatMessages },
        './logic': { validUuid },
        './files': {
          sanitizeChatFile: async () => {
            events.push('decode');
            return { bytes: Buffer.from('safe'), mime: 'text/plain', name: 'file.txt' };
          },
        },
      });
      const form = new FormData();
      form.set('id', itemId);
      const size =
        scenario === 'oversized_image'
          ? 5 * 1024 * 1024 + 1
          : scenario === 'oversized_pdf'
            ? 10 * 1024 * 1024 + 1
            : 3;
      const mime = scenario === 'oversized_image' ? 'image/png' : 'application/pdf';
      for (let n = 0; n < (scenario === 'too_many' ? 4 : 1); n++) {
        const file = new File(['abc'], 'file', { type: mime });
        Object.defineProperty(file, 'size', { value: size });
        file.arrayBuffer = async () => {
          events.push('read');
          return new ArrayBuffer(3);
        };
        form.append('files', file);
        form.append('file_ids', fileId);
      }
      const result = await chatCommand(homeId, 'send', form);
      if (scenario === 'success') {
        assert.equal(result.ok, itemId);
        assert.deepEqual(events, [
          'authorize_chat_uploads',
          'read',
          'decode',
          'prepare_chat_attachment',
          'send_chat_message',
        ]);
      } else {
        assert.ok(result.error);
        assert.ok(!events.includes('read'), events.join(', '));
        assert.ok(!events.includes('decode'), events.join(', '));
      }
    });
  }
});

test('receipts store the sanitized PDF re-serialization, never the uploaded bytes', async () => {
  const doc = await PDFDocument.create();
  doc.addPage();
  doc.setAuthor('Uploader name');
  doc.setProducer('Original tool');
  const pdf = await doc.save({ useObjectStreams: false });
  const checked = await receiptFile('application/pdf', pdf.length, pdf);
  assert.equal(checked?.extension, 'pdf');
  assert.ok(checked?.bytes, 'PDF receipts must carry the bytes to store');
  assert.notDeepEqual(Buffer.from(checked.bytes), Buffer.from(pdf));
  const stored = await PDFDocument.load(checked.bytes, { updateMetadata: false });
  assert.equal(stored.getAuthor(), '');
  assert.equal(stored.getProducer(), 'RoomieHub');
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
  assert.deepEqual(await receiptFile('image/png', png.length, png), { extension: 'png' });
});
