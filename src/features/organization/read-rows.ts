// Supabase caps each response. Follow pages so history and pending work never disappear
// silently after the first 1,000 rows. Callers supply a stable order ending in the primary key.
export async function readRows<Row>(query: {
  range(
    from: number,
    to: number,
  ): PromiseLike<{
    data: Row[] | null;
    error: { message: string; code: string } | null;
  }>;
}) {
  const rows: Row[] = [];
  const size = 500;
  for (let offset = 0; ; offset += size) {
    const result = await query.range(offset, offset + size - 1);
    if (result.error) return { data: null, error: result.error };
    rows.push(...(result.data ?? []));
    if ((result.data?.length ?? 0) < size) return { data: rows, error: null };
  }
}
