// Decimal MB: leave room for multipart fields below the hosting request limit.
export const AVATAR_MAX_BYTES = 4_000_000;
export function validAvatarFile(file: { type: string; size: number }) {
  return (
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.type) &&
    file.size > 0 &&
    file.size <= AVATAR_MAX_BYTES
  );
}
export function matchingPasswords(password: string, confirmation: string) {
  return password.length > 0 && password === confirmation;
}
export function avatarInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return [words[0], words.length > 1 ? words.at(-1) : undefined]
    .filter(Boolean)
    .map((word) => Array.from(word!)[0])
    .join('')
    .toLocaleUpperCase();
}
