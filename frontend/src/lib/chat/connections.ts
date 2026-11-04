import messages from '../../../messages/en.json';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  agentConnectionsSchema,
  agentScopeSchema,
  canSeeAgent,
  type AgentViewer,
} from './agentRules';
import { connectedKinds, connectionKindOf, neededConnections } from './agentConnections';
import { GETCITO_SKILLS, CATALOG_CONNECTION, CMS_CONNECTION } from './agentSkills';
import { NO_CONNECTION_ROWS, readConnectionRows, type ConnectionRows } from './connectionRows';

/**
 * Connections in Chat (Chat Wave 4, W4-24; agentic plan §6, CHAT-01 item
 * 169): one list of the tools a brand can connect, built from the one read
 * of its rows (connectionRows.ts), which the agents' checks use too. The
 * chat menu's Connections row, the Connections page and Chat's
 * list_connections all read it, so a tool connected anywhere (Settings ›
 * Integrations, the Content page's webhook, Product Visibility) shows
 * connected everywhere, and nothing is connected twice.
 *
 * Connections are per brand, as the app keeps them (Brand-level access;
 * owner decision 15): the list is for one brand. A tool is connected,
 * failing (its sign-in was refused, or is gone while the brand keeps the
 * property), not connected, or Soon: a tool no
 * integration offers yet, listed so people see what is coming, with
 * nothing to click (as Agent Center's Soon cards). Merchant Center is
 * listed only where this deployment offers it, or once a brand has it.
 *
 * Connecting stays where it is today, in Settings › Integrations (or the
 * Content page for a webhook): a card's Connect and Settings open it.
 * Nothing here holds a key or token, nor a person's id: a record names the
 * tool, the account as the person picked it (a site, a store, a Search
 * Console property, an Analytics property id), who connected it and when.
 */

/** The groups the Connections page filters by. */
export const CONNECTION_CATEGORIES = ['search', 'cms', 'ecommerce', 'crm', 'team'] as const;
export type ConnectionCategory = (typeof CONNECTION_CATEGORIES)[number];

/** What a connected tool lets GetCito do: read only, write drafts, or send pages out. */
export const CONNECTION_ACCESS = ['read_only', 'read_write_drafts', 'sends_pages'] as const;
export type ConnectionAccess = (typeof CONNECTION_ACCESS)[number];

/** How a brand lets go of a tool from Chat: its CMS site, or its Google property. Null: in Settings. */
export type ConnectionDisconnect = 'cms' | 'property';

export interface ConnectionTool {
  /** Its key: chatConnections.tools.{key} in messages/en.json names it. */
  key: string;
  category: ConnectionCategory;
  /** The kind an agent asks for (agentSkills.ts); null for a tool no integration offers yet. */
  kind: string | null;
  access: ConnectionAccess | null;
  /** Where it is connected and managed. */
  settingsHref: `/dashboard/${string}` | null;
  disconnect: ConnectionDisconnect | null;
  /** Listed only where the deployment offers it, or once the brand has it. */
  offeredOnly?: true;
}

const INTEGRATIONS = '/dashboard/settings/integrations';
/** Stores, feeds and uploads share Settings › Integrations' product catalog card. */
const CATALOG_CARD = `${INTEGRATIONS}#product-catalog` as const;

const tool = (
  key: string,
  category: ConnectionCategory,
  kind: string,
  access: ConnectionAccess,
  extra: Partial<ConnectionTool> = {},
): ConnectionTool => ({
  key,
  category,
  kind,
  access,
  settingsHref: `${INTEGRATIONS}#${key.replace(/_/g, '-')}` as `/dashboard/${string}`,
  disconnect: null,
  ...extra,
});

const soon = (key: string, category: ConnectionCategory): ConnectionTool => ({
  key,
  category,
  kind: null,
  access: null,
  settingsHref: null,
  disconnect: null,
});

/**
 * Every tool, in the order the page lists them. The live ones first in
 * each group; then the agentic plan's launch list that no integration
 * offers yet, as Soon (owner decision 15 B).
 */
export const CONNECTION_TOOLS: readonly ConnectionTool[] = [
  tool('google_search_console', 'search', 'google_search_console', 'read_only', {
    disconnect: 'property',
  }),
  tool('google_analytics', 'search', 'google_analytics', 'read_only', { disconnect: 'property' }),
  soon('bing_webmaster_tools', 'search'),
  tool('webflow', 'cms', CMS_CONNECTION, 'read_write_drafts', { disconnect: 'cms' }),
  tool('wordpress', 'cms', CMS_CONNECTION, 'read_write_drafts', { disconnect: 'cms' }),
  tool('framer', 'cms', CMS_CONNECTION, 'read_write_drafts', { disconnect: 'cms' }),
  tool('wix', 'cms', CMS_CONNECTION, 'read_write_drafts', { disconnect: 'cms' }),
  // A workflow webhook that takes sent pages: set on the Content page.
  tool('webhook', 'cms', CMS_CONNECTION, 'sends_pages', { settingsHref: '/dashboard/content' }),
  soon('contentful', 'cms'),
  soon('sanity', 'cms'),
  tool('merchant_center', 'ecommerce', CATALOG_CONNECTION, 'read_only', { offeredOnly: true }),
  tool('woocommerce', 'ecommerce', CATALOG_CONNECTION, 'read_only', { settingsHref: CATALOG_CARD }),
  // A feed URL the API reads daily, or a file someone uploaded.
  tool('product_feed', 'ecommerce', CATALOG_CONNECTION, 'read_only', {
    settingsHref: CATALOG_CARD,
  }),
  soon('shopify', 'ecommerce'),
  soon('hubspot', 'crm'),
  soon('salesforce', 'crm'),
  soon('pipedrive', 'crm'),
  soon('stripe', 'crm'),
  soon('google_sheets', 'team'),
  soon('looker_studio', 'team'),
  soon('slack', 'team'),
  soon('microsoft_teams', 'team'),
  soon('zapier', 'team'),
];

export function connectionTool(key: string): ConnectionTool | null {
  return CONNECTION_TOOLS.find((t) => t.key === key) ?? null;
}

/** The catalog source kinds each e-commerce tool reads (catalog_sources.kind). */
const CATALOG_KINDS: Record<string, readonly string[]> = {
  merchant_center: ['merchant_center'],
  woocommerce: ['woocommerce'],
  product_feed: ['feed_url', 'upload'],
};

/** The Google sign-in each property tool needs (integration_connections.provider). */
const SIGN_IN_PROVIDER: Record<string, string> = {
  google_search_console: 'google-search-console',
  google_analytics: 'google-analytics',
  merchant_center: 'google-merchant-center',
};

/** The page-sent event a CMS workflow takes pages by (agentConnections.ts). */
const PAGE_SENT_EVENT = 'content_draft.sent';

export type ConnectionStatus = 'connected' | 'failing' | 'not_connected' | 'soon';

/** One tool for one brand, as the menu, the page and Chat see it: no key, token or person's id. */
export interface ConnectionRecord {
  key: string;
  category: ConnectionCategory;
  status: ConnectionStatus;
  /** The account as the person picked it: "Acme site", "sc-domain:acme.com", an Analytics property id, "acme.shop +1". */
  account: string | null;
  /** Who connected it, by name, and when (ISO); null when the app doesn't keep it. */
  connectedBy: string | null;
  connectedAt: string | null;
  access: ConnectionAccess | null;
  /** The skills ("/publish") and the brand's agents that use it: "Used by", or "Would unlock". */
  uses: string[];
  /** The brand's agents that need it and would stop without it: what Disconnect warns of. */
  stops: string[];
  /** One of up to two tools worth connecting first. */
  suggested: boolean;
  settingsHref: string | null;
  /** How Chat's Disconnect lets go of it for the brand; null where it's done in Settings. */
  disconnect: ConnectionDisconnect | null;
}

/** An agent of the brand, as the records need it: its name and the connections it needs. */
export interface BrandAgent {
  name: string;
  needs: { kind: string; required: boolean }[];
}

/** The workspace's sign-ins behind the Google property tools (integration_connections). */
export interface SignInRow {
  provider: string;
  status: string;
  connected_by: string | null;
  created_at: string | null;
}

export interface RecordInput {
  rows: ConnectionRows;
  agents?: readonly BrandAgent[];
  signIns?: readonly SignInRow[];
  /** People's names by id, for "by Sam Lee". */
  names?: ReadonlyMap<string, string>;
  /** This deployment offers Merchant Center (its sign-in is set up). */
  merchantCenterOffered?: boolean;
}

/** The skills that use a kind, as /commands, in the library's order. */
function skillsUsing(kind: string): string[] {
  return GETCITO_SKILLS.filter((skill) => skill.uses.some((use) => use.key === kind)).map(
    (skill) => `/${skill.id}`,
  );
}

/** A list of account names as one line: the first two, then "+N". */
function accountsLine(names: (string | null | undefined)[]): string | null {
  const named = [...new Set(names.map((n) => n?.trim()).filter((n): n is string => !!n))];
  if (named.length === 0) return null;
  const shown = named.slice(0, 2).join(', ');
  return named.length > 2 ? `${shown} +${named.length - 2}` : shown;
}

/** A feed's account: its label, else its address's host. */
function feedName(source: ConnectionRows['catalog'][number]): string | null {
  if (source.label) return source.label;
  if (source.kind === 'upload') return messages.chatConnections.uploadedFile;
  try {
    return source.url ? new URL(source.url).host : null;
  } catch {
    return null;
  }
}

/** The earliest of some timestamps, or null. */
const earliest = (values: (string | null | undefined)[]) =>
  values.filter((v): v is string => !!v).sort()[0] ?? null;

interface ToolState {
  status: 'connected' | 'failing' | 'not_connected';
  account: string | null;
  connectedById: string | null;
  connectedAt: string | null;
}

const NOT_CONNECTED: ToolState = {
  status: 'not_connected',
  account: null,
  connectedById: null,
  connectedAt: null,
};

/** A live tool's state from the brand's rows. */
function stateOf(t: ConnectionTool, input: RecordInput): ToolState {
  const { rows } = input;
  const signIn = input.signIns?.find((s) => s.provider === SIGN_IN_PROVIDER[t.key]);
  if (t.key === 'google_search_console' || t.key === 'google_analytics') {
    const property =
      t.key === 'google_search_console' ? rows.brand?.gsc_property : rows.brand?.ga_property_id;
    if (!property) return NOT_CONNECTED;
    // Disconnect in Settings drops the sign-in but leaves the property: without one it fails.
    return {
      status: signIn?.status === 'connected' ? 'connected' : 'failing',
      account: property,
      connectedById: signIn?.connected_by ?? null,
      connectedAt: signIn?.created_at ?? null,
    };
  }
  if (t.category === 'cms' && t.key !== 'webhook') {
    const site = rows.cms.find((c) => c.provider === t.key);
    if (!site) return NOT_CONNECTED;
    return {
      status: site.status === 'connected' ? 'connected' : 'failing',
      account: site.site_name?.trim() || null,
      connectedById: site.connected_by ?? null,
      connectedAt: site.created_at ?? null,
    };
  }
  if (t.key === 'webhook') {
    const hooks = rows.webhooks.filter((w) => w.events?.includes(PAGE_SENT_EVENT));
    if (hooks.length === 0) return NOT_CONNECTED;
    return {
      status: 'connected',
      account: accountsLine(hooks.map((w) => w.name)),
      connectedById: null,
      connectedAt: earliest(hooks.map((w) => w.created_at)),
    };
  }
  const kinds = CATALOG_KINDS[t.key] ?? [];
  const sources = rows.catalog.filter((s) => kinds.includes(s.kind));
  if (sources.length === 0) return NOT_CONNECTED;
  const working = sources.filter((s) => s.last_status !== 'auth_failed');
  // The first connected, by its day; a source without one (an older row) comes last.
  const first = [...(working.length ? working : sources)].sort((a, b) =>
    (a.created_at ?? '\uffff').localeCompare(b.created_at ?? '\uffff'),
  )[0];
  return {
    status: working.length > 0 ? 'connected' : 'failing',
    account: accountsLine(
      sources.map((s) => (t.key === 'product_feed' ? feedName(s) : (s.account ?? s.label))),
    ),
    connectedById: first?.created_by ?? null,
    connectedAt: first?.created_at ?? null,
  };
}

/** The brand's agents that use a kind, by name, in the order given. */
const agentsUsing = (agents: readonly BrandAgent[], kind: string, required?: true) =>
  agents
    .filter((a) => a.needs.some((n) => n.kind === kind && (!required || n.required)))
    .map((a) => a.name);

/**
 * A brand's tools as records (pure): each live tool's state from its rows,
 * what uses it, what would stop without it, and up to two Suggested ones,
 * in CONNECTION_TOOLS' order.
 */
export function connectionRecords(input: RecordInput): ConnectionRecord[] {
  const agents = input.agents ?? [];
  const states = new Map<string, ToolState>();
  for (const t of CONNECTION_TOOLS) if (t.kind) states.set(t.key, stateOf(t, input));
  const listed = CONNECTION_TOOLS.filter(
    (t) =>
      !t.offeredOnly ||
      input.merchantCenterOffered === true ||
      states.get(t.key)?.status !== 'not_connected',
  );
  const kinds = connectedKinds(input.rows, input.signIns ?? []);
  // Kinds the brand's agents ask for that it lacks; a kind of one tool only can be suggested.
  const toolsOfKind = (kind: string) => listed.filter((t) => t.kind === kind);
  const wanted = [
    ...new Set(agents.flatMap((a) => a.needs.map((n) => n.kind)).filter((k) => !kinds.has(k))),
  ];
  const suggested = new Set<string>();
  for (const kind of wanted) {
    const only = toolsOfKind(kind);
    if (only.length === 1) suggested.add(only[0].key);
  }
  // Then Search Console, then Analytics: the data most of GetCito reads.
  for (const key of ['google_search_console', 'google_analytics']) {
    if (states.get(key)?.status === 'not_connected') suggested.add(key);
  }

  // At most two, in the order found.
  const picks = [...suggested]
    .filter((key) => states.get(key)?.status === 'not_connected')
    .slice(0, 2);

  return listed.map((t): ConnectionRecord => {
    if (!t.kind) {
      return {
        key: t.key,
        category: t.category,
        status: 'soon',
        account: null,
        connectedBy: null,
        connectedAt: null,
        access: null,
        uses: [],
        stops: [],
        suggested: false,
        settingsHref: null,
        disconnect: null,
      };
    }
    const state = states.get(t.key) ?? NOT_CONNECTED;
    // Another tool of its kind still connected keeps the agents going.
    const othersOfKind = toolsOfKind(t.kind).some(
      (other) => other.key !== t.key && states.get(other.key)?.status === 'connected',
    );
    const lost = state.status !== 'not_connected' && !othersOfKind;
    return {
      key: t.key,
      category: t.category,
      status: state.status,
      account: state.account,
      connectedBy: state.connectedById ? (input.names?.get(state.connectedById) ?? null) : null,
      connectedAt: state.connectedAt,
      access: t.access,
      uses: [...skillsUsing(t.kind), ...agentsUsing(agents, t.kind)],
      stops: lost ? agentsUsing(agents, t.kind, true) : [],
      suggested: picks.includes(t.key),
      settingsHref: t.settingsHref,
      disconnect: t.disconnect,
    };
  });
}

// ─── Reads (server only) ─────────────────────────────────────────────────────

const ACTIVE_AGENT_STATUSES = ['active', 'paused'];

/**
 * The agents a person sees (agent-rules canSeeAgent) that run on the brand,
 * active or paused, with the connections their current version needs
 * (agent-connections neededConnections: a skill's Required one too), by kind.
 */
export async function readBrandAgents(
  organizationId: string,
  brandId: string,
  viewer: AgentViewer,
): Promise<BrandAgent[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_agents')
    .select('id, name, status, owner_id, visibility, version')
    .eq('organization_id', organizationId)
    .in('status', ACTIVE_AGENT_STATUSES)
    .order('name', { ascending: true });
  if (error) throw new Error(`Could not read the agents: ${error.message}`);
  const agents = (data ?? []) as {
    id: string;
    name: string;
    owner_id: string | null;
    visibility: string;
    version: number;
  }[];
  if (agents.length === 0) return [];
  const versions = await supabaseAdmin
    .from('chat_agent_versions')
    .select('agent_id, version, skill_ids, connections, scope')
    .in(
      'agent_id',
      agents.map((a) => a.id),
    )
    .in('version', [...new Set(agents.map((a) => a.version))]);
  if (versions.error) throw new Error(`Could not read the agents: ${versions.error.message}`);
  const out: BrandAgent[] = [];
  for (const agent of agents) {
    const row = ((versions.data ?? []) as Record<string, unknown>[]).find(
      (v) => v.agent_id === agent.id && v.version === agent.version,
    );
    if (!row) continue;
    const scope = agentScopeSchema.safeParse(row.scope);
    const connections = agentConnectionsSchema.safeParse(row.connections);
    if (!scope.success) continue;
    const onBrand = scope.data.all_brands === true || scope.data.brand_ids?.includes(brandId);
    const facts = {
      ownerId: agent.owner_id,
      visibility: agent.visibility === 'workspace' ? 'workspace' : 'private',
      scope: scope.data,
    } as const;
    if (!onBrand || !canSeeAgent(facts, viewer)) continue;
    const needed = neededConnections(
      Array.isArray(row.skill_ids) ? (row.skill_ids as string[]) : [],
      connections.success ? connections.data : [],
    );
    const needs = needed.flatMap((c) => {
      const kind = connectionKindOf(c.key);
      return kind ? [{ kind, required: c.required }] : [];
    });
    if (needs.length > 0) out.push({ name: agent.name, needs });
  }
  return out;
}

/** The workspace's Google sign-ins (Search Console, Analytics, Merchant Center). */
export async function readSignIns(organizationId: string): Promise<SignInRow[]> {
  const { data, error } = await supabaseAdmin
    .from('integration_connections')
    .select('provider, status, connected_by, created_at')
    .eq('organization_id', organizationId);
  if (error) throw new Error(`Could not read the sign-ins: ${error.message}`);
  return ((data ?? []) as SignInRow[]).filter((row) => row.status === 'connected');
}

/** People's names by id ("Sam Lee"), for who connected what. */
export async function readNames(
  organizationId: string,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (wanted.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id, full_name')
    .eq('organization_id', organizationId)
    .in('id', wanted);
  if (error) throw new Error(`Could not read names: ${error.message}`);
  return new Map(
    ((data ?? []) as { id: string; full_name: string | null }[])
      .filter((p) => p.full_name?.trim())
      .map((p) => [p.id, p.full_name!.trim()]),
  );
}

/** Who connected what, by id, in a brand's rows and the sign-ins. */
function connectorIds(rows: ConnectionRows, signIns: readonly SignInRow[]): (string | null)[] {
  return [
    ...rows.cms.map((c) => c.connected_by ?? null),
    ...rows.catalog.map((c) => c.created_by ?? null),
    ...signIns.map((s) => s.connected_by),
  ];
}

/**
 * A brand's connections for the person: its rows, the workspace's sign-ins,
 * the agents they see on the brand and who connected what. The caller has
 * checked they reach the brand. Server only.
 */
export async function readConnections(params: {
  organizationId: string;
  brandId: string;
  viewer: AgentViewer;
  merchantCenterOffered: boolean;
}): Promise<ConnectionRecord[]> {
  const [rowsByBrand, signIns, agents] = await Promise.all([
    readConnectionRows([params.brandId]),
    readSignIns(params.organizationId),
    readBrandAgents(params.organizationId, params.brandId, params.viewer),
  ]);
  const rows = rowsByBrand.get(params.brandId) ?? NO_CONNECTION_ROWS;
  const names = await readNames(params.organizationId, connectorIds(rows, signIns));
  return connectionRecords({
    rows,
    agents,
    signIns,
    names,
    merchantCenterOffered: params.merchantCenterOffered,
  });
}

/** A tool's name as the app shows it ("Google Search Console"). */
export const connectionToolName = (key: string): string =>
  (messages.chatConnections.tools as Record<string, { name: string }>)[key]?.name ?? key;
