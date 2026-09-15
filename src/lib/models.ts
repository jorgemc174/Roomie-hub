export type Profile = {
  id: string;
  name: string;
  avatar_path: string | null;
  locale: 'es' | 'en';
  theme: 'light' | 'dark';
};
export type Home = {
  id: string;
  name: string;
  image_path: string | null;
  currency: string;
  week_starts_on: number;
  timezone: string;
  created_at: string;
};
export type Member = {
  user_id: string;
  active: boolean;
  joined_at: string;
  profiles: { name: string; avatar_path: string | null } | null;
};
