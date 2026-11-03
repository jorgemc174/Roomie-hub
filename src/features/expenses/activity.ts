import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import type { Category } from './money';
import type { Settlement } from './models';

type Revision = Database['public']['Tables']['expense_events']['Row'];
export type ExpenseActivity =
  | { id: string; kind: 'revision'; recorded_at: string; payload: Revision }
  | { id: string; kind: 'payment'; recorded_at: string; payload: Settlement };

// Module-local additive schema contract, pending normal Supabase type generation.
type ActivityDatabase = {
  public: Omit<Database['public'], 'Functions'> & {
    Functions: Database['public']['Functions'] & {
      expense_category_totals: {
        Args: { target: string; selected_category: Category | null };
        Returns: { category: Category; amount: string }[];
      };
      expense_activity: {
        Args: { target: string; page_index: number };
        Returns: ExpenseActivity[];
      };
    };
  };
};
export async function readExpenseActivity(
  db: SupabaseClient<Database>,
  homeId: string,
  page: number,
) {
  const client = db as unknown as SupabaseClient<ActivityDatabase>;
  const result = await client.rpc('expense_activity', { target: homeId, page_index: page });
  if (result.error) throw new Error('finance_read_failed');
  return result.data ?? [];
}

export async function readCategoryTotals(
  db: SupabaseClient<Database>,
  homeId: string,
  category?: Category,
) {
  const client = db as unknown as SupabaseClient<ActivityDatabase>;
  const result = await client.rpc('expense_category_totals', {
    target: homeId,
    selected_category: category ?? null,
  });
  if (result.error) throw new Error('finance_read_failed');
  return result.data ?? [];
}
