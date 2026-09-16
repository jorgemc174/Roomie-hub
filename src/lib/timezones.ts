export const DEFAULT_HOME_TIMEZONE = 'Europe/Madrid';
export const COMMON_TIMEZONES = [
  'Europe/Madrid',
  'Atlantic/Canary',
  'Europe/London',
  'Europe/Paris',
  'America/New_York',
  'America/Los_Angeles',
  'America/Mexico_City',
  'America/Argentina/Buenos_Aires',
  'Asia/Tokyo',
  'Asia/Shanghai',
  'Australia/Sydney',
  'UTC',
] as const;
export function validTimezone(zone: string): boolean {
  if (zone !== 'UTC' && !zone.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en', { timeZone: zone }).format(0);
    return true;
  } catch {
    return false;
  }
}
export function homeDate(timezone: string, instant: string | Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const value = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}
