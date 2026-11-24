export async function GET(request: Request, { params }: { params: Promise<{ homeId: string }> }) {
  const { homeId } = await params;
  const search = new URL(request.url).searchParams;
  const tab = search.get('tab');
  search.delete('tab');
  const section = tab === 'shopping' ? 'expenses' : 'community';
  const query = new URLSearchParams({
    tab: tab === 'shopping' || tab === 'absences' ? tab : 'tasks',
  });
  for (const [key, value] of search) query.append(key, value);
  // A real HTTP redirect lets browsers carry legacy #task and #shopping fragments.
  return new Response(null, {
    status: 307,
    headers: { Location: `/homes/${encodeURIComponent(homeId)}/${section}?${query}` },
  });
}
