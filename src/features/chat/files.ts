import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';
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
  if (mime !== 'application/pdf' || Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-')
    throw new Error('invalid_attachment');
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
  const forbidden = new Set([
    'JS',
    'JavaScript',
    'AA',
    'OpenAction',
    'Launch',
    'EmbeddedFiles',
    'EmbeddedFile',
    'XFA',
    'RichMedia',
    'SubmitForm',
    'ImportData',
    'GoToR',
  ]);
  const seen = new Set<object>();
  const inspect = (obj: unknown) => {
    if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
    seen.add(obj);
    if (obj instanceof PDFName && forbidden.has(obj.decodeText()))
      throw new Error('invalid_attachment');
    if (obj instanceof PDFRef) return;
    if (obj instanceof PDFDict)
      for (const [k, v] of obj.entries()) {
        inspect(k);
        inspect(v);
      }
    if (obj instanceof PDFArray) for (let i = 0; i < obj.size(); i++) inspect(obj.get(i));
  };
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    inspect(obj);
    if ('dict' in obj) inspect(obj.dict);
  }
  if (doc.getPageCount() > 1000) throw new Error('invalid_attachment');
  doc.setAuthor('');
  doc.setCreator('RoomieHub');
  doc.setProducer('RoomieHub');
  doc.setTitle('');
  doc.setSubject('');
  doc.setKeywords([]);
  return {
    bytes: Buffer.from(await doc.save()),
    mime,
    name: label.replace(/\.[^.]+$/, '') + '.pdf',
  };
}
