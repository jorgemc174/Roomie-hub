import type { ChatMessage, ChatAttachment, ChatReaction } from '@/features/chat/models';
import type { Notice, NoticePreference, StoredPush } from '@/features/notifications/models';
import type {
  RatingReason,
  Rating,
  Redemption,
  Punishment,
  CommunityBalance,
  AuthorLabel,
} from '@/features/community/models';
import type { Resource, Reservation, Activity, ActivityMember } from '@/features/calendar/models';
import type {
  Expense,
  ExpenseSplit,
  Settlement,
  Recurring,
  Occurrence,
  Receipt,
  Balance,
  Json,
} from '@/features/expenses/models';
// Schema contract for 202609150001_foundation.sql. Regenerate with Supabase CLI after migrations.
import type { Home, Profile } from '../models';
import type {
  Chore,
  ChoreInstance,
  RotationMember,
  Absence,
  ShoppingList,
  ShoppingItem,
  AssignmentEvent,
} from '@/features/organization/models';
type Table<
  Row,
  Relationships extends {
    foreignKeyName: string;
    columns: string[];
    isOneToOne: boolean;
    referencedRelation: string;
    referencedColumns: string[];
  }[] = [],
> = {
  Row: Row;
  Insert: Partial<Row>;
  Update: Partial<Row>;
  Relationships: Relationships;
};
export type Database = {
  public: {
    Tables: {
      chat_messages: Table<ChatMessage>;
      chat_attachments: Table<ChatAttachment>;
      chat_reactions: Table<ChatReaction>;
      notifications: Table<Notice>;
      notification_preferences: Table<NoticePreference>;
      push_subscriptions: Table<StoredPush>;
      rating_reasons: Table<RatingReason>;
      ratings: Table<Rating>;
      rating_redemptions: Table<Redemption>;
      punishments: Table<Punishment>;
      resources: Table<Resource>;
      reservations: Table<Reservation>;
      activities: Table<Activity>;
      activity_members: Table<ActivityMember>;
      expenses: Table<Expense>;
      expense_splits: Table<ExpenseSplit>;
      settlements: Table<Settlement>;
      recurring_expenses: Table<Recurring>;
      recurring_expense_instances: Table<Occurrence>;
      expense_attachments: Table<Receipt>;
      expense_events: Table<{
        id: string;
        home_id: string;
        expense_id: string;
        actor: string;
        actor_name: string;
        recorded_at: string;
        revision: number;
        snapshot: Json;
      }>;
      shopping_list_expense_links: Table<{
        home_id: string;
        shopping_list_id: string;
        expense_id: string;
      }>;
      chores: Table<Chore>;
      chore_instances: Table<ChoreInstance>;
      chore_rotation_members: Table<RotationMember>;
      absences: Table<Absence>;
      shopping_lists: Table<ShoppingList>;
      shopping_items: Table<ShoppingItem>;
      chore_assignment_events: Table<AssignmentEvent>;
      profiles: Table<Profile & { created_at: string }>;
      homes: Table<Home>;
      home_members: Table<
        {
          home_id: string;
          user_id: string;
          active: boolean;
          joined_at: string;
          penalty_active_since: string | null;
          left_at: string | null;
        },
        [
          {
            foreignKeyName: 'home_members_user_id_fkey';
            columns: ['user_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'home_members_home_id_fkey';
            columns: ['home_id'];
            isOneToOne: false;
            referencedRelation: 'homes';
            referencedColumns: ['id'];
          },
        ]
      >;
      invitations: Table<{ home_id: string; code: string; regenerated_at: string }>;
    };
    Views: Record<string, never>;
    Functions: {
      send_chat_message: {
        Args: {
          target: string;
          item: string;
          message_body: string;
          reply?: string | null;
          files?: string[];
        };
        Returns: string;
      };
      edit_chat_message: {
        Args: { target: string; item: string; expected_version: number; message_body: string };
        Returns: undefined;
      };
      delete_chat_message: {
        Args: { target: string; item: string; expected_version: number };
        Returns: undefined;
      };
      set_chat_reaction: {
        Args: { target: string; item: string; reaction: string; enabled: boolean };
        Returns: undefined;
      };
      prepare_chat_attachment: {
        Args: {
          target: string;
          item: string;
          label: string;
          media_type: string;
          content_hash: string;
          byte_size: number;
        };
        Returns: string;
      };
      chat_file_access: { Args: { object_path: string; write_access?: boolean }; Returns: boolean };
      chat_page: {
        Args: { target: string; before_at?: string | null; before_id?: string | null };
        Returns: Json;
      };
      save_notification_preferences: {
        Args: {
          group_name: string;
          app_enabled: boolean;
          email_enabled: boolean;
          push_enabled: boolean;
          offsets: number[];
          expected_version: number;
        };
        Returns: undefined;
      };
      mark_notifications_read: { Args: { item?: string | null }; Returns: undefined };
      save_push_subscription: {
        Args: {
          push_endpoint: string;
          public_key: string;
          auth_secret: string;
          device_label?: string;
        };
        Returns: string;
      };
      revoke_push_subscription: { Args: { item?: string | null }; Returns: undefined };
      run_notification_jobs: { Args: Record<string, never>; Returns: Json };
      claim_notification_deliveries: { Args: { channels: string[] }; Returns: Json };
      notification_delivery_valid: {
        Args: { item: string; lease_token: string };
        Returns: boolean;
      };
      finish_notification_delivery: {
        Args: { item: string; lease_token: string; outcome: string; error_code?: string | null };
        Returns: undefined;
      };
      notification_job_status: { Args: Record<string, never>; Returns: Json };
      community_balances: { Args: { target: string }; Returns: CommunityBalance[] };
      rating_author_labels: { Args: { target: string; items: string[] }; Returns: AuthorLabel[] };
      reconcile_community: {
        Args: { target: string };
        Returns: { created: number; processed: number; more: boolean };
      };
      initialize_rating_reasons: {
        Args: { target: string; language_code: string };
        Returns: undefined;
      };
      save_rating_reason: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          label: string;
          sign: string;
          needs_text: boolean;
          enabled: boolean;
        };
        Returns: string;
      };
      save_rating: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          person: string;
          reason: string;
          notes: string;
          anonymous: boolean;
        };
        Returns: string;
      };
      delete_rating: {
        Args: { target: string; item: string; expected_version: number };
        Returns: undefined;
      };
      save_punishment: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          notes: string;
          finish: boolean;
        };
        Returns: undefined;
      };
      prepare_rating_photo: { Args: { target: string; item: string }; Returns: string };
      attach_rating_photo: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          object_path: string | null;
        };
        Returns: undefined;
      };

      save_resource: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          label: string;
          notes: string;
          enabled: boolean;
        };
        Returns: string;
      };
      initialize_resources: { Args: { target: string; language_code: string }; Returns: undefined };
      save_reservation: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          resource: string;
          person: string;
          label: string;
          start_local: string;
          end_local: string;
          expected_timezone: string;
        };
        Returns: string;
      };
      cancel_reservation: {
        Args: { target: string; item: string; expected_version: number };
        Returns: undefined;
      };
      save_activity: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          label: string;
          notes: string;
          place: string;
          start_local: string;
          end_local: string | null;
          expected_timezone: string;
        };
        Returns: string;
      };
      cancel_activity: {
        Args: { target: string; item: string; expected_version: number };
        Returns: undefined;
      };
      set_activity_attendance: {
        Args: { target: string; item: string; joining: boolean };
        Returns: undefined;
      };

      save_expense: {
        Args: { target: string; item: string; expected_version: number; body: Json };
        Returns: string;
      };
      delete_expense: {
        Args: { target: string; item: string; expected_version: number };
        Returns: undefined;
      };
      expense_balances: { Args: { target: string }; Returns: Balance[] };
      record_settlement: {
        Args: {
          target: string;
          item: string;
          sender: string;
          recipient: string;
          total: string;
          on_date: string;
        };
        Returns: string;
      };
      leave_home: { Args: { target: string }; Returns: undefined };
      save_recurring_expense: {
        Args: {
          target: string;
          item: string;
          expected_version: number;
          body: Json;
          recurrence_kind: string;
          freq: string;
          n: number;
          anchor: string;
          enabled: boolean;
        };
        Returns: string;
      };
      generate_recurring_expenses: {
        Args: { target: string };
        Returns: { processed: number; more: boolean };
      };
      confirm_recurring_expense: {
        Args: { target: string; item: string; body: Json };
        Returns: string;
      };
      attach_expense_receipt: {
        Args: {
          target: string;
          item: string;
          object_path: string;
          media_type: string;
          byte_size: number;
        };
        Returns: undefined;
      };

      ensure_current_chores: {
        Args: { target: string };
        Returns: { created: number; blocked: number };
      };
      update_home_timezone: { Args: { target: string; zone: string }; Returns: undefined };
      home_local_date: { Args: { target: string; at_instant?: string }; Returns: string };
      save_chore: {
        Args: {
          target: string;
          chore: string | null;
          task_name: string;
          task_description: string;
          weight: number;
          enabled: boolean;
          kind: string;
          every_n: number;
          anchor: string;
          mode: string;
          rotation: string[];
          due_days: number | null;
          due_time: string;
          due_timezone: string;
        };
        Returns: string;
      };
      generate_chore_instances: {
        Args: { target: string; from_date: string; through_date: string };
        Returns: { created: number; blocked: number };
      };
      reconcile_chore_assignments: { Args: { target: string }; Returns: number };
      initialize_chores: { Args: { target: string; language_code: string }; Returns: undefined };
      save_absence: {
        Args: {
          target: string;
          absence: string | null;
          person: string;
          starts: string;
          ends: string;
          remove: boolean;
        };
        Returns: string;
      };
      complete_chore: { Args: { target: string; instance: string }; Returns: undefined };
      shopping_command: {
        Args: {
          target: string;
          operation: string;
          list_id?: string | null;
          item_id?: string | null;
          label?: string | null;
          checked?: boolean;
        };
        Returns: string;
      };
      create_home: { Args: { home_name: string; home_currency?: string }; Returns: string };
      join_home: { Args: { invite_code: string }; Returns: string };
      update_home: {
        Args: {
          target: string;
          home_name: string;
          home_currency: string;
          home_image: string | null;
          week_start: number;
        };
        Returns: undefined;
      };
      regenerate_invitation: { Args: { target: string }; Returns: string };
      delete_home: { Args: { target: string }; Returns: undefined };
      is_home_member: { Args: { target: string }; Returns: boolean };
      can_read_profile: { Args: { target: string }; Returns: boolean };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
