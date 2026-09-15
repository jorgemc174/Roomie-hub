export function safeNext(value: string | null): string {
  if (!value || value.length > 2048) return '/homes';
  let candidate = value;
  // Check encoded separators/control characters as well as the literal destination.
  for (let depth = 0; depth < 5; depth++) {
    if (
      !candidate.startsWith('/') ||
      candidate.startsWith('//') ||
      /[\\\u0000-\u0020\u007f]/.test(candidate)
    )
      return '/homes';
    try {
      const url = new URL(candidate, 'https://roomiehub.invalid');
      if (url.origin !== 'https://roomiehub.invalid' || url.pathname.startsWith('//'))
        return '/homes';
      const decoded = decodeURIComponent(candidate);
      if (decoded === candidate) return value;
      candidate = decoded;
    } catch {
      return '/homes';
    }
  }
  return '/homes';
}
export function validName(value: string) {
  return value.trim().length >= 2 && value.trim().length <= 80;
}
export function validImage(bytes: Uint8Array, mime: string) {
  if (mime === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === 'image/jpeg') return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/webp')
    return (
      String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
    );
  return false;
}
