export const categories = [
  'tasks',
  'reservations',
  'activities',
  'expenses',
  'community',
  'chat',
] as const;
export type NotificationCategory = (typeof categories)[number];
export type Notice = {
  id: string;
  user_id: string;
  home_id: string;
  category: NotificationCategory;
  event_type: string;
  title: string;
  body: string;
  target_url: string;
  source_table: string;
  source_id: string;
  source_version: string;
  event_at: string | null;
  reminder_minutes: number | null;
  visible: boolean;
  dedupe_key: string;
  created_at: string;
  read_at: string | null;
  invalidated_at: string | null;
};
export type NoticePreference = {
  user_id: string;
  category: NotificationCategory;
  in_app: boolean;
  email: boolean;
  push: boolean;
  reminder_minutes: number[];
  version: number;
};
export type StoredPush = {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
  active: boolean;
  label: string;
  created_at: string;
  updated_at: string;
};
