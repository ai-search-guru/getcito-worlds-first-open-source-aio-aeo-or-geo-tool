import { permanentRedirect } from 'next/navigation';

// Agents moved out of Chat into Agent Center (/dashboard/agents), its own
// item under Chat on the menu. Links to the old routes (bookmarks, shared
// links, older builds) land on the same page there for good, query kept:
// /dashboard/chat/agents/new?skill=winback → /dashboard/agents/new?skill=winback.
export default async function OldAgentsRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ path?: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { path = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const one of [value ?? []].flat()) query.append(key, one);
  }
  const rest = path.map((segment) => `/${encodeURIComponent(segment)}`).join('');
  const search = query.toString();
  permanentRedirect(`/dashboard/agents${rest}${search ? `?${search}` : ''}`);
}
