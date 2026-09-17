import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { sanitizeRatingPhoto } from '../src/features/community/photo';
import { rankMembers, type CommunityBalance } from '../src/features/community/models';
import { communityMessages } from '../src/features/community/messages';
test('ranking: effective negatives first, available positives next, stable ID and active members only', () => {
  const row = (id: string, n: number, p: number, active = true) =>
    ({
      user_id: id,
      user_name: id,
      negative_effective: n,
      positive_available: p,
      active,
    }) as CommunityBalance;
  assert.deepEqual(
    rankMembers([
      row('Ana', 1, 0),
      row('Jorge', 2, 20),
      row('Pablo', 1, 3),
      row('Former', 0, 20, false),
    ]).map((x) => x.user_id),
    ['Pablo', 'Ana', 'Jorge'],
  );
  assert.deepEqual(
    rankMembers([row('B', 0, 0), row('A', 0, 0)]).map((x) => x.user_id),
    ['A', 'B'],
  );
  assert.deepEqual(
    Object.keys(communityMessages('es')).sort(),
    Object.keys(communityMessages('en')).sort(),
  );
});
test('rating photos: decode JPEG/PNG/WebP, remove EXIF, reject format mismatch, executable and oversize', async () => {
  const input = sharp({ create: { width: 24, height: 24, channels: 3, background: '#aabbcc' } });
  const jpg = await input
    .jpeg()
    .withExif({ IFD0: { Artist: 'Secret uploader' } })
    .toBuffer();
  assert.ok((await sharp(jpg).metadata()).exif);
  const clean = await sanitizeRatingPhoto(jpg, 'image/jpeg'),
    meta = await sharp(clean).metadata();
  assert.equal(meta.format, 'webp');
  assert.equal(meta.exif, undefined);
  assert.equal(meta.xmp, undefined);
  assert.equal(clean.includes(Buffer.from('Secret uploader')), false);
  await sanitizeRatingPhoto(await input.png().toBuffer(), 'image/png');
  await sanitizeRatingPhoto(await input.webp().toBuffer(), 'image/webp');
  await assert.rejects(sanitizeRatingPhoto(jpg, 'image/png'));
  await assert.rejects(sanitizeRatingPhoto(Buffer.from('MZ executable'), 'image/jpeg'));
  await assert.rejects(sanitizeRatingPhoto(Buffer.from('%PDF-1.4'), 'application/pdf'));
  await assert.rejects(sanitizeRatingPhoto(new Uint8Array(5 * 1024 * 1024 + 1), 'image/jpeg'));
});
