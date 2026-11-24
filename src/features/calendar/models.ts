export type Resource = {
  id: string;
  home_id: string;
  name: string;
  description: string;
  active: boolean;
  seed_key: string | null;
  version: number;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
};
export type Reservation = {
  id: string;
  home_id: string;
  resource_id: string;
  resource_name: string;
  title: string;
  responsible_id: string;
  responsible_name: string;
  starts_at: string;
  ends_at: string;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  version: number;
  create_request: import('@/features/expenses/models').Json;
};
export type Activity = {
  id: string;
  home_id: string;
  title: string;
  description: string;
  location: string;
  location_kind: 'home' | 'outside' | null;
  participant_request: import('@/features/expenses/models').Json | null;
  starts_at: string;
  ends_at: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  version: number;
  create_request: import('@/features/expenses/models').Json;
};
export type ActivityMember = {
  home_id: string;
  activity_id: string;
  user_id: string;
  user_name: string;
  attending: boolean;
  response: 'going' | 'maybe' | 'not_going';
  joined_at: string;
  updated_at: string;
};
export type EventSource = 'tasks' | 'reservations' | 'activities' | 'expenses';
export type CalendarEvent = {
  id: string;
  sourceType: EventSource;
  sourceId: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  status: 'pending' | 'completed' | 'overdue' | 'scheduled';
  people: string[];
  names: string[];
  location?: string;
  resourceId?: string;
  href: string;
};
// Lean records for client components: the agenda never needs idempotency metadata.
export type ActivityView = Pick<
  Activity,
  | 'id'
  | 'title'
  | 'description'
  | 'location'
  | 'location_kind'
  | 'starts_at'
  | 'ends_at'
  | 'created_by'
  | 'created_by_name'
  | 'cancelled_at'
  | 'version'
>;
export type ReservationView = Pick<
  Reservation,
  | 'id'
  | 'resource_id'
  | 'resource_name'
  | 'title'
  | 'responsible_id'
  | 'responsible_name'
  | 'starts_at'
  | 'ends_at'
  | 'cancelled_at'
  | 'version'
>;
export type ParticipantView = Pick<
  ActivityMember,
  'activity_id' | 'user_id' | 'user_name' | 'response'
>;
export type ResourceOption = Pick<Resource, 'id' | 'name' | 'active'>;
export type Person = { user_id: string; name: string };
// Everything the calendar needs to create, show and manage its own records in place.
export type CalendarManage = {
  activities: ActivityView[];
  participants: ParticipantView[];
  reservations: ReservationView[];
  resources: ResourceOption[];
  people: Person[];
  createIds: { activity: string; reservation: string };
  now: string;
  nowLocal: string;
  create: 'activity' | 'reservation' | '';
  closeLabel: string;
};
export type CalendarAgendaProps = {
  homeId: string;
  locale: import('@/lib/i18n/dictionaries').Locale;
  timezone: string;
  userId: string;
  day: string;
  today: string;
  resource: string;
  events: CalendarEvent[];
  manage: CalendarManage;
};
