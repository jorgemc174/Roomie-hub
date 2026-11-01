import { sanitizePdf } from '@/lib/files/pdf';

// PDFs are stored as re-serialized by pdf-lib, never as uploaded: validating one parse
// and storing the original bytes would let parser differentials (polyglots) through.
export async function receiptFile(
  mime: string,
  size: number,
  bytes: Uint8Array,
): Promise<{ extension: string; bytes?: Uint8Array<ArrayBuffer> } | null> {
  if (size < 1 || size > 10485760) return null;
  if (mime === 'application/pdf') {
    if (bytes.length !== size) return null;
    try {
      const clean = new Uint8Array(await sanitizePdf(bytes));
      return clean.length <= 10485760 ? { extension: 'pdf', bytes: clean } : null;
    } catch {
      return null;
    }
  }
  const ascii = new TextDecoder().decode(bytes);
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return { extension: 'jpg' };
  if (mime === 'image/png' && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10')
    return { extension: 'png' };
  if (mime === 'image/webp' && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    return { extension: 'webp' };
  return null;
}

export async function receiptExtension(
  mime: string,
  size: number,
  bytes: Uint8Array,
): Promise<string | null> {
  return (await receiptFile(mime, size, bytes))?.extension ?? null;
}
