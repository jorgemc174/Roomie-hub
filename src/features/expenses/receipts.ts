export function receiptExtension(mime: string, size: number, bytes: Uint8Array): string | null {
  if (size < 1 || size > 10485760) return null;
  const ascii = new TextDecoder().decode(bytes);
  if (mime === 'application/pdf' && ascii.startsWith('%PDF-')) return 'pdf';
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return 'jpg';
  if (mime === 'image/png' && bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10')
    return 'png';
  if (mime === 'image/webp' && ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP')
    return 'webp';
  return null;
}
