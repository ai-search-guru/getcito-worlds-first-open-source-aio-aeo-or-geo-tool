import messages from '../../../messages/en.json';
import type { AgentConnection } from './agentRules';
import {
  CATALOG_CONNECTION,
  CMS_CONNECTION,
  connectionKindOf,
  skillConnections,
} from './agentSkills';
import { NO_CONNECTION_ROWS, readConnectionRows } from './connectionRows';

/**
 * Whether a brand has the connections an agent asks for (CHAT-21 §D item
 * 21, §H item 42), read before each of its runs (agentDriver.ts). A
 * missing Required one keeps the run from starting and pauses a triggered
 * agent (`connection`); a missing Optional one is said in the run, which
 * does everything else.
 *
 * Read from what the app already keeps per brand, as Chat's
 * list_connections reads it: any CMS is a connected Webflow, WordPress,
 * Framer or Wix site (brand_cms_connections) or an active workflow webhook
 * that takes sent pages (webhook_configs, content_draft.sent); any catalog
 * source is a feed, upload, store or Merchant Center source whose sign-in
 * still works (catalog_sources); Search Console and Analytics are the
 * brand's picked property, and where the workspace's Google sign-ins are
 * given, only while its sign-in is connected. Agents saved before connections were kinds name
 * a product (`webflow`, `shopify`): it counts as its kind. A connection
 * this can't read (one no integration offers yet) isn't held against a run.
 */

const CONNECTION_NAMES: Record<string, string> = messages.chatAgents.connections.names;

/** A connection's name as the app shows it: "Any CMS", "Google Search Console". */
export const connectionName = (key: string) => CONNECTION_NAMES[key] ?? key;

// The kinds, pure for the Skills page's chips too (agentSkills.ts).
export { connectionKindOf };

/** The webhook event a CMS workflow takes pages by (server content-delivery's DELIVERY_EVENT). */
const PAGE_SENT_EVENT = 'content_draft.sent';

/** What a brand has connected, as its rows hold it. */
export interface BrandConnectionRows {
  brand: { gsc_property: string | null; ga_property_id: string | null } | null;
  cms: { provider: string; status: string }[];
  webhooks: { events: string[] | null }[];
  catalog: { kind: string; last_status: string | null }[];
}

/** The Google sign-in each property kind needs (integration_connections.provider). */
const PROPERTY_SIGN_IN: Record<string, string> = {
  google_search_console: 'google-search-console',
  google_analytics: 'google-analytics',
};

/**
 * The kinds a brand has connected. Given the workspace's sign-ins, a picked
 * property counts only while its Google sign-in is connected: Disconnect in
 * Settings drops the sign-in but leaves the brand's property set.
 */
export function connectedKinds(
  rows: BrandConnectionRows,
  signIns?: readonly { provider: string; status: string }[],
): Set<string> {
  const kinds = new Set<string>();
  if (
    rows.cms.some((c) => c.status === 'connected') ||
    rows.webhooks.some((w) => w.events?.includes(PAGE_SENT_EVENT))
  ) {
    kinds.add(CMS_CONNECTION);
  }
  if (rows.catalog.some((source) => source.last_status !== 'auth_failed')) {
    kinds.add(CATALOG_CONNECTION);
  }
  const signedIn = (kind: string) =>
    !signIns ||
    signIns.some((s) => s.provider === PROPERTY_SIGN_IN[kind] && s.status === 'connected');
  if (rows.brand?.gsc_property && signedIn('google_search_console')) {
    kinds.add('google_search_console');
  }
  if (rows.brand?.ga_property_id && signedIn('google_analytics')) kinds.add('google_analytics');
  return kinds;
}

/**
 * The connections a version needs: the ones it was saved with, and each one
 * its skills can't work without as Required even when the saved list leaves
 * it out or has it Optional (an agent saved through the API or MCP sends its
 * own list): /publish never runs without a CMS.
 */
export function neededConnections(
  skillIds: readonly string[],
  connections: readonly AgentConnection[],
): AgentConnection[] {
  const out = connections.map((c) => ({ ...c }));
  for (const need of skillConnections(skillIds)) {
    if (!need.required) continue;
    const kept = out.find((c) => c.key === need.key);
    if (kept) kept.required = true;
    else out.push({ key: need.key, required: true });
  }
  return out;
}

/** The agent's connections the brand lacks: Required ones keep a run from starting. */
export function connectionGaps(
  connections: readonly AgentConnection[],
  connected: ReadonlySet<string>,
): { required: string[]; optional: string[] } {
  const gaps = { required: [] as string[], optional: [] as string[] };
  for (const c of connections) {
    const kind = connectionKindOf(c.key);
    if (!kind || connected.has(kind)) continue;
    (c.required ? gaps.required : gaps.optional).push(c.key);
  }
  return gaps;
}

/** The kinds a brand has connected now, from the one read of connections (connectionRows.ts). Server only. */
export async function readBrandConnections(brandId: string): Promise<Set<string>> {
  const rows = await readConnectionRows([brandId]);
  return connectedKinds(rows.get(brandId) ?? NO_CONNECTION_ROWS);
}

/**
 * The first Required connection of the agent's the brand lacks, or null:
 * Run now and Run agent refuse with it before they queue anything, so a
 * click never gets a run that stops without a word, and Resume before the
 * agent is on again, so it isn't paused again on its next run. Server only.
 */
export async function missingRequiredConnection(
  version: { skill_ids: readonly string[]; connections: readonly AgentConnection[] },
  brandId: string,
): Promise<string | null> {
  const needed = neededConnections(version.skill_ids, version.connections);
  if (!needed.some((c) => c.required && connectionKindOf(c.key))) return null;
  return connectionGaps(needed, await readBrandConnections(brandId)).required[0] ?? null;
}
