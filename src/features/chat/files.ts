import { sanitizePdf } from '@/lib/files/pdf';
import { sanitizeRatingPhoto } from '@/features/community/photo';
import { attachmentName } from './logic';
export async function sanitizeChatFile(bytes: Uint8Array, mime: string, name: string) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('invalid_attachment');
  const label = attachmentName(name);
  if (['image/jpeg', 'image/png', 'image/webp'].includes(mime))
    return {
      bytes: await sanitizeRatingPhoto(bytes, mime),
      mime: 'image/webp',
      name: label.replace(/\.[^.]+$/, '') + '.webp',
    };
  if (mime === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (/[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text) || /^\s*(?:<|#!|MZ|%PDF)/u.test(text))
      throw new Error('invalid_attachment');
    return { bytes: Buffer.from(text, 'utf8'), mime, name: label.replace(/\.[^.]+$/, '') + '.txt' };
  }
  if (mime !== 'application/pdf') throw new Error('invalid_attachment');
  return {
    bytes: await sanitizePdf(bytes),
    mime,
    name: label.replace(/\.[^.]+$/, '') + '.pdf',
  };
}
