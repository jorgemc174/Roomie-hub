export function validDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function addDays(value: string, days: number): string {
  return new Date(Date.parse(value) + days * 86400000).toISOString().slice(0, 10);
}
export function validDifficulty(value: number) {
  return Number.isInteger(value) && value >= 1 && value <= 5;
}
// Phase 5 hook: floor elapsed 24-hour blocks; stop the clock at completion.
// Point creation belongs to a future transactional job, with unique(instance_id, overdue_day).
export function overdueDays(
  deadline: string | null,
  now: string,
  completed: string | null = null,
): number {
  if (!deadline) return 0;
  const duration = Date.parse(completed ?? now) - Date.parse(deadline);
  if (!Number.isFinite(duration)) throw new Error('invalid_date');
  return Math.max(0, Math.floor(duration / 86400000));
}
export function instanceStatus(deadline: string | null, completed: string | null, now: string) {
  return completed
    ? 'completed'
    : deadline && Date.parse(deadline) < Date.parse(now)
      ? 'overdue'
      : 'pending';
}
