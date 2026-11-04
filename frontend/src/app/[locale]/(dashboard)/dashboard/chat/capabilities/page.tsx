import { notFound } from 'next/navigation';
import { getChatAccess } from '@/lib/actions/chatAccess';
import { capabilityAreas } from '@/lib/chat/access';
import { registryCatalog } from '@/lib/chat/registry/tools';
import {
  CapabilitiesUnavailable,
  CapabilitiesView,
} from '@/components/chat-access/CapabilitiesView';

/**
 * "What Chat can do" (CHAT-20 §8, mockup #g-capabilities): every tool in
 * Chat's registry, by area, with who may use it and how it is approved.
 * Built from the registry the server checks, so it can't drift from it; a
 * capability not listed isn't Chat's ("silence = never"). Only with the new
 * Chat on for the workspace.
 */
export default async function ChatCapabilitiesPage() {
  const result = await getChatAccess();
  if (!result.ok && result.failure === 'chat_off') notFound();
  // The database didn't answer: say so in plain words, with a way to try again.
  if (!result.ok) return <CapabilitiesUnavailable />;
  return <CapabilitiesView access={result.access} areas={capabilityAreas(registryCatalog())} />;
}
