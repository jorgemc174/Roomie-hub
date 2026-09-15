/** Phase boundaries. Implement persisted models via reviewed RLS migrations, never client mocks. */
export const futureModules = ['calendar', 'organization', 'expenses', 'community', 'chat'] as const;
export type FutureModule = (typeof futureModules)[number];
export type NotificationChannel = 'in_app' | 'push' | 'email';
export type JobEnvelope = { idempotencyKey: string; homeId: string; scheduledAt: string };
export type Money = { minorUnits: bigint; currency: string };
export type ReminderOffsetMinutes = 15 | 60 | 1440;
