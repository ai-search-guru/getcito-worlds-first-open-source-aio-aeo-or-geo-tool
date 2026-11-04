import { z } from 'zod';

/**
 * Where a chat started (chat_conversations.origin, origin_page; CHAT-01
 * data notes): Chat's own page, or an app page's side panel. The page is a
 * path, never a full address.
 */
export const originPageSchema = z
  .string()
  .max(500)
  .regex(/^\/dashboard(\/[\w\-.~%]*)*$/);
