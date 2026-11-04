import { redirect } from 'next/navigation';

// A topic's page moved under Prompts with the Topics view (/dashboard/prompts/topics).
export default async function TopicRedirect({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/dashboard/prompts/topics/${encodeURIComponent(id)}`);
}
