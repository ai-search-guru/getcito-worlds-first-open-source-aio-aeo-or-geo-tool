import { NextResponse } from 'next/server';
import { agentRunDriver } from '@/lib/chat/agentDriver';
import { fireSignals, signalBatchSchema } from '@/lib/chat/agentTriggers';
import { internalCallRefusal } from '@/lib/chat/internalCall';

// The runs it starts are driven past the answer (after()), within this.
export const maxDuration = 300;

/**
 * POST /api/internal/chat/agents/signals `{ brandId, signals: [{ id, kind, definitions, urls, engines }] }`
 *
 * The API server's hook after Action Center's signal pass found new signals
 * on a brand (CHAT-21 §E: Signal created), with
 * `Authorization: Bearer ${CHAT_INTERNAL_SECRET}`: fires the Signal triggers
 * they match, with the noise rules, and starts what the workspace has room
 * for. No model is called.
 *
 * 404 with the new Chat off, 401 without the secret, 400 a bad body; 200
 * with what the fires came to.
 */
export async function POST(req: Request) {
  const refusal = internalCallRefusal(req);
  if (refusal) return refusal;
  const input = signalBatchSchema.safeParse(await req.json().catch(() => null));
  if (!input.success) {
    return NextResponse.json({ ok: false, error: 'invalid' }, { status: 400 });
  }
  try {
    const fired = await fireSignals(input.data, new Date(), agentRunDriver);
    return NextResponse.json({ ok: true, fired });
  } catch (error) {
    console.error('[chat/agents] signal triggers failed:', error);
    return NextResponse.json({ ok: false, error: 'failed' }, { status: 500 });
  }
}
