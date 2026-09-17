export function safeLink(value: string): string | null {
  try {
    const u = new URL(value);
    return ['http:', 'https:'].includes(u.protocol) && !u.username && !u.password ? u.href : null;
  } catch {
    return null;
  }
}
export function textParts(text: string) {
  return text
    .split(/(https?:\/\/[^\s<>]+)/gu)
    .filter(Boolean)
    .map((value) => ({ text: value, href: /^https?:\/\//u.test(value) ? safeLink(value) : null }));
}
export function attachmentName(name: string) {
  return name.replace(/[\x00-\x1f\x7f/\\<>:"|?*]/g, '_').slice(0, 120) || 'file';
}
export function validUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}
