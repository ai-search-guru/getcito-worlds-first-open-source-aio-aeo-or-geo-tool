import { notFound } from 'next/navigation';
import { ChatSuggestion, SuggestionUnavailable } from '@/components/chat/SuggestionDetail';
import { readDailySuggestion } from '@/lib/actions/chatSuggestions';
import { suggestionPageId } from '@/lib/chat/dailySuggestions';
import { chatComposerSetup, chatPageOpen } from '../../_chatPageAccess';

/**
 * A daily suggestion's page (CHAT-26 §2.3, mockup #d-detail): one action
 * from the person's Action Center, built as "Why did it move?" is, with
 * Content Editor, Do it with Chat, Not now, Remove and the composer that
 * starts a chat scoped to it. Only with the new Chat on for the workspace
 * (CHAT_AGENTIC), and only for a suggestion's id; one removed, deleted or
 * not the person's says it isn't available.
 */
export default async function ChatSuggestionPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await chatPageOpen())) notFound();
  const id = suggestionPageId((await params).id);
  if (!id) notFound();
  const [result, setup] = await Promise.all([readDailySuggestion(id), chatComposerSetup()]);
  if (!result.ok) {
    if (result.failure === 'chat_off') notFound();
    return <SuggestionUnavailable />;
  }
  // Keyed by the suggestion: another one opens fresh, not over this one.
  return <ChatSuggestion key={id} detail={result.detail} setup={setup} />;
}
