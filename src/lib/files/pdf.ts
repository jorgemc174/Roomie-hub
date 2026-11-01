import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from 'pdf-lib';

export async function sanitizePdf(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) throw new Error('invalid_attachment');
  const text = Buffer.from(bytes).toString('latin1');
  if (!/^%PDF-\d\.\d[\r\n]/u.test(text) || !/[\r\n]%%EOF[\t\n\f\r ]*$/u.test(text))
    throw new Error('invalid_attachment');
  const doc = await PDFDocument.load(bytes, {
    ignoreEncryption: false,
    updateMetadata: false,
    throwOnInvalidObject: true,
  });
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
  // The parsed names cover escaped names and compressed object streams as well.
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
  return Buffer.from(await doc.save());
}
