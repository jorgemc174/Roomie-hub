import { readRows } from '@/features/organization/read-rows';
export async function calendarRows<Row>(query: Parameters<typeof readRows<Row>>[0]) {
  const r = await readRows(query);
  if (r.error) throw r.error;
  return r.data;
}
