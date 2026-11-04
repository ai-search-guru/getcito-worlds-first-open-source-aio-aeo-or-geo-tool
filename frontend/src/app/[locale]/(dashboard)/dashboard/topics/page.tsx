import { redirect } from 'next/navigation';

// Topics moved into the Prompts area, as its Topics tab. Links to the old
// route (bookmarks, shared links, older builds) land there.
export default function TopicsPage() {
  redirect('/dashboard/prompts/topics');
}
