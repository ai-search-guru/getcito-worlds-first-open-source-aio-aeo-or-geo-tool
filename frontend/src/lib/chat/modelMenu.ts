import { API_BASE_URL } from '@/config/api';
import { AUTO_MODEL, OFFERED_MODELS, offeredModel } from './models';

/**
 * Chat's model menu as the browser reads it (CHAT-16 §A–B, W4-01): Auto at
 * 1x, the offered models (lib/chat/models.ts) with their multiplier labels
 * and tones from the API server's daily price sync, the model a chat runs
 * on (even when the catalog dropped it, so the menu can say it went back to
 * Auto), how many chat models the catalog has, and when it was synced. No
 * price ever: the server answers labels only (CHAT-04). Server code only
 * (CRON_SECRET).
 */

export type ModelTone = 'low' | 'normal' | 'high';

export interface ChatMenuModel {
  id: string;
  name: string;
  /** "2.3x", "<0.1x"; null until the catalog is synced. */
  multiplier: string | null;
  /** low: under 1x (green); high: 3x and up (amber); null without a multiplier. */
  tone: ModelTone | null;
  /** Its price changes by the hour or day. */
  variesByHour: boolean;
  /** The workspace's own key runs it (Enterprise, or a kept key's days). */
  yourKey: boolean;
}

export interface ChatModelMenu {
  auto: { id: typeof AUTO_MODEL; multiplier: '1x'; tone: 'normal' };
  models: ChatMenuModel[];
  /** The chat's model when it isn't Auto: `removed` once the catalog dropped it. */
  selected: { id: string; removed: boolean } | null;
  /** Chat models in the catalog that can call tools ("Search {n} models…"). */
  catalogCount: number;
  /** The last sync (ISO); null before the first. */
  updatedAt: string | null;
}

/** How long the menu waits for the API server. */
export const MENU_TIMEOUT_MS = 4_000;

interface ServerModel {
  id: string;
  name: string;
  multiplier: string | null;
  tone: ModelTone | null;
  variesByHour: boolean;
  removed: boolean;
}

interface ServerMenu {
  models?: ServerModel[];
  selected?: ServerModel | null;
  catalogCount?: number;
  updatedAt?: string | null;
}

/** The API server's menu, or null when it doesn't answer in time or CRON_SECRET isn't set. */
async function readServerMenu(selected: string | null): Promise<ServerMenu | null> {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error('[chat/model-menu] CRON_SECRET must be configured for Chat');
    return null;
  }
  const query = new URLSearchParams({ ids: OFFERED_MODELS.map((m) => m.id).join(',') });
  if (selected && selected !== AUTO_MODEL) query.set('selected', selected);
  try {
    const res = await fetch(`${API_BASE_URL}/api/internal/chat/models?${query}`, {
      headers: { Authorization: `Bearer ${secret}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(MENU_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('[chat/model-menu] the API server answered', res.status);
      return null;
    }
    return (await res.json()) as ServerMenu;
  } catch (err) {
    console.error('[chat/model-menu] got no answer:', (err as Error)?.name ?? err);
    return null;
  }
}

/**
 * The menu for a workspace. `ownKeyProvider`: the provider of the own key
 * Chat runs on, if any; its models say "Your key". When the API server
 * doesn't answer, the offered models still show, with no multipliers.
 */
export async function readModelMenu({
  selected = null,
  ownKeyProvider = null,
}: {
  selected?: string | null;
  ownKeyProvider?: string | null;
} = {}): Promise<ChatModelMenu> {
  const server = await readServerMenu(selected);
  const byId = new Map((server?.models ?? []).map((model) => [model.id, model]));
  const models: ChatMenuModel[] = [];
  for (const offered of OFFERED_MODELS) {
    const listed = byId.get(offered.id);
    // The server leaves a dropped model out; with no answer, every offered one shows.
    if (server && !listed) continue;
    models.push({
      id: offered.id,
      name: listed?.name ?? offered.id,
      multiplier: listed?.multiplier ?? null,
      tone: listed?.tone ?? null,
      variesByHour: listed?.variesByHour ?? false,
      yourKey: ownKeyProvider === offered.provider,
    });
  }
  const chosen = selected && selected !== AUTO_MODEL ? selected : null;
  return {
    auto: { id: AUTO_MODEL, multiplier: '1x', tone: 'normal' },
    models,
    selected: chosen
      ? {
          id: chosen,
          // A model no longer offered runs Auto too.
          removed: !offeredModel(chosen) || (server?.selected?.removed ?? false),
        }
      : null,
    catalogCount: server?.catalogCount ?? 0,
    updatedAt: server?.updatedAt ?? null,
  };
}
