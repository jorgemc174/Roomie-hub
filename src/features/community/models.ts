export type RatingReason = {
  id: string;
  home_id: string;
  name: string;
  kind: 'positive' | 'negative';
  requires_text: boolean;
  active: boolean;
  seed_key: string | null;
  version: number;
};
export type Rating = {
  id: string;
  home_id: string;
  target_user_id: string;
  target_name: string;
  kind: 'positive' | 'negative';
  initial_kind: 'positive' | 'negative';
  reason_id: string | null;
  reason_name: string;
  custom_text: string;
  is_anonymous: boolean;
  source: 'manual' | 'task_overdue' | 'system';
  source_id: string | null;
  overdue_day: number | null;
  attachment_path: string | null;
  created_at: string;
  effective_at: string;
  updated_at: string;
  deleted_at: string | null;
  version: number;
};
export type Redemption = {
  id: string;
  home_id: string;
  user_id: string;
  positive_ids: string[];
  negative_id: string | null;
  created_at: string;
  revoked_at: string | null;
};
export type Punishment = {
  id: string;
  home_id: string;
  user_id: string;
  user_name: string;
  threshold: number;
  severity: 'light' | 'heavy';
  description: string;
  triggered_at: string;
  completed_at: string | null;
  completed_by: string | null;
  completed_by_name: string | null;
  version: number;
};
export type CommunityBalance = {
  user_id: string;
  user_name: string;
  active: boolean;
  positive_history: number;
  negative_history: number;
  positive_available: number;
  positive_consumed: number;
  negative_effective: number;
  credits: number;
  pending_punishments: number;
};
export type AuthorLabel = {
  rating_id: string;
  author_id: string | null;
  author_name: string | null;
  is_mine: boolean;
};
export function rankMembers(rows: CommunityBalance[]) {
  return rows
    .filter((r) => r.active)
    .sort(
      (a, b) =>
        Number(a.negative_effective) - Number(b.negative_effective) ||
        Number(b.positive_available) - Number(a.positive_available) ||
        a.user_id.localeCompare(b.user_id),
    );
}
export type SavedPunishment = { text: string; severity: Punishment['severity']; uses: number };
// Every described consequence becomes reusable: same severity first, then most used, then most recent.
export function savedPunishments(
  rows: Pick<Punishment, 'description' | 'severity' | 'triggered_at'>[],
  severity?: Punishment['severity'],
  limit = 12,
) {
  const byText = new Map<string, SavedPunishment & { last: string }>();
  for (const row of rows) {
    const text = row.description.trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLocaleLowerCase('es');
    const found = byText.get(key);
    if (!found) byText.set(key, { text, severity: row.severity, uses: 1, last: row.triggered_at });
    else {
      found.uses += 1;
      if (row.triggered_at > found.last)
        Object.assign(found, { text, severity: row.severity, last: row.triggered_at });
    }
  }
  return [...byText.values()]
    .sort(
      (a, b) =>
        Number(b.severity === severity) - Number(a.severity === severity) ||
        b.uses - a.uses ||
        b.last.localeCompare(a.last) ||
        a.text.localeCompare(b.text),
    )
    .slice(0, limit)
    .map(({ text, severity: kind, uses }) => ({ text, severity: kind, uses }));
}
