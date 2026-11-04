import { NextResponse } from 'next/server';
import { AUTO_MODEL, isCatalogId } from '@/lib/chat/models';
import { ownChatKeyProvider } from '@/lib/chat/key';
import { readModelMenu } from '@/lib/chat/modelMenu';
import { chatActor, runFailure } from '@/lib/chat/runApi';

/**
 * GET /api/chat/models?selected={model}
 *
 * Chat's model menu (CHAT-16 §A–B, W4-01): Auto, the offered models with
 * their multiplier labels and tones, "Your key" on the own key's models, the
 * chat's model (`selected`, flagged once the catalog dropped it), the
 * catalog's size and its last sync. Never a price. Not there (404) while the
 * new Chat is off for the workspace.
 *
 * Answers `{ ok: true, menu }`, or `{ ok: false, failure, code, error }`.
 */
export async function GET(req: Request) {
  try {
    const actor = await chatActor();
    if (actor instanceof NextResponse) return actor;
    const asked = new URL(req.url).searchParams.get('selected');
    // A model no longer offered is asked for too: the menu says the chat runs Auto now.
    const selected = asked === AUTO_MODEL || isCatalogId(asked) ? asked : null;
    const ownKeyProvider = await ownChatKeyProvider(actor.organizationId).catch(() => null);
    const menu = await readModelMenu({ selected, ownKeyProvider });
    return NextResponse.json({ ok: true, menu });
  } catch (error) {
    console.error('[chat/models] could not read the model menu:', error);
    return runFailure(500, 'failed', 'failed', 'Failed to read the models');
  }
}
