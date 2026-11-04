/** A new chat started, or why it couldn't be: the API's code and words, when it said. */
export type StartedChat =
  | { ok: true; chatId: string }
  | { ok: false; code: string | null; error: string | null };

/**
 * Starts a new chat with `message` (POST /api/chat/runs) on the brand open,
 * in the person's own time zone: Chat Home's suggestions and shortcuts
 * (W2-09: the shortcut's id goes with it) and a skill's Run on the Skills
 * page (W3-07). The run goes on without the page; its stream
 * is let go once the chat's id is known, and the chat picks it up. Client
 * only. Never throws.
 */
export async function startChatRun(
  message: string,
  brandId: string | null,
  { shortcutId }: { shortcutId?: string } = {},
): Promise<StartedChat> {
  const res = await fetch('/api/chat/runs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      brandId: brandId ?? undefined,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      ...(shortcutId ? { shortcutId } : {}),
    }),
  }).catch(() => null);
  const chatId = res?.ok ? res.headers.get('x-chat-conversation') : null;
  if (!res?.ok || !chatId) {
    const body = (await res?.json().catch(() => null)) as {
      code?: string;
      error?: string;
    } | null;
    return { ok: false, code: body?.code ?? null, error: body?.error ?? null };
  }
  void res.body?.cancel().catch(() => undefined);
  return { ok: true, chatId };
}
