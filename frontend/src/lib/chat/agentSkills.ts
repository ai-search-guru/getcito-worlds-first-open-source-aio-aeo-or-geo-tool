/**
 * The skills an agent is made of (CHAT-21 §D step 1) until Chat's skills
 * registry (CHAT-13) lists them: GetCito's own skills (Chat agentic plan
 * §4), the governance mockup's ten first, with the connections each one
 * uses, Required or Optional (§D step 4). Their titles are
 * chatAgents.skills.{id}. Pure.
 *
 * A connection is a kind, never one product: `cms` is any CMS the brand
 * sends pages to (Webflow, WordPress, Framer, Wix or a workflow webhook),
 * `catalog` any source of its product catalog (Merchant Center, a feed, a
 * store). Only what a skill can't work without is Required: /publish sends
 * the page, /shopping reads the catalog. /winback and /tasks write their
 * drafts without a CMS, and /report and /winback read without Search
 * Console: those are Optional, and a run without them does the rest
 * (§H item 42).
 *
 * Then CHAT-24 §5's seven for the focus areas (W2-23b), in the library's
 * order (SKILL_ORDER). Their SKILL.md files read only GetCito's own data
 * (answers, fan-outs, citations, mentions, the site audit and the pages
 * they fetch) and save page work as drafts, so they use no connection:
 * /listings reads the sites AI cites, not a catalog, and /audit-fix writes
 * a robots or CMS change for the person to make.
 *
 * A workspace's own skills (CHAT-13, W3-06) are instructions only: an
 * agent may name one by its /command, and it needs no connection (skillOf
 * gives none). Whether it may run now is the workspace's to say
 * (offAgentSkill, from skills/store.ts agentSkillStates).
 */

/** A connection a skill uses, and whether it can't work without it. */
export interface SkillConnection {
  key: string;
  required: boolean;
}

export interface AgentSkill {
  /** Its `/command` without the slash, as chat_agent_versions.skill_ids keeps it. */
  id: string;
  /** The connections it uses: an agent that runs it gets them, Required or Optional as here. */
  uses: readonly SkillConnection[];
}

/** Any CMS the brand sends pages to. */
export const CMS_CONNECTION = 'cms';
/** Any source of the brand's product catalog. */
export const CATALOG_CONNECTION = 'catalog';

/** The kinds a brand's connections are read as, and the products saved agents may name for them. */
const KIND_OF: Record<string, string> = {
  [CMS_CONNECTION]: CMS_CONNECTION,
  webflow: CMS_CONNECTION,
  wordpress: CMS_CONNECTION,
  framer: CMS_CONNECTION,
  wix: CMS_CONNECTION,
  webhook: CMS_CONNECTION,
  [CATALOG_CONNECTION]: CATALOG_CONNECTION,
  shopify: CATALOG_CONNECTION,
  merchant_center: CATALOG_CONNECTION,
  google_search_console: 'google_search_console',
  gsc: 'google_search_console',
  google_analytics: 'google_analytics',
  ga4: 'google_analytics',
};

/** A connection key as the kind it is read as (agentConnections.ts), or null for one not read. */
export const connectionKindOf = (key: string): string | null => KIND_OF[key] ?? null;

const optional = (key: string): SkillConnection => ({ key, required: false });
const required = (key: string): SkillConnection => ({ key, required: true });

export const GETCITO_SKILLS: readonly AgentSkill[] = [
  { id: 'winback', uses: [optional('google_search_console'), optional(CMS_CONNECTION)] },
  { id: 'tasks', uses: [optional(CMS_CONNECTION)] },
  { id: 'quality', uses: [] },
  { id: 'faq', uses: [] },
  { id: 'report', uses: [optional('google_search_console')] },
  { id: 'beat', uses: [] },
  { id: 'refresh', uses: [] },
  { id: 'publish', uses: [required(CMS_CONNECTION)] },
  { id: 'shopping', uses: [required(CATALOG_CONNECTION)] },
  { id: 'wrongclaim', uses: [] },
  { id: 'answerfirst', uses: [] },
  { id: 'facts', uses: [] },
  { id: 'compare', uses: [] },
  { id: 'translate', uses: [] },
  { id: 'questions', uses: [] },
  { id: 'features', uses: [] },
  { id: 'gaps', uses: [] },
  { id: 'markets', uses: [] },
  { id: 'listings', uses: [] },
  { id: 'rivals', uses: [] },
  { id: 'audit-fix', uses: [] },
];

/** Connections any agent may add as Optional (mockup: Google Analytics). */
export const OPTIONAL_CONNECTIONS: readonly string[] = ['google_analytics'];

/** Follow-on skills an agent may add after its primary one (§D step 1). */
export const MAX_FOLLOW_ON_SKILLS = 2;

export function skillOf(id: string): AgentSkill | null {
  return GETCITO_SKILLS.find((skill) => skill.id === id) ?? null;
}

/**
 * The connections a list of skills uses, in order, once each: Required when
 * one of the skills can't work without it, with the skill that needs it
 * (else the first that uses it).
 */
export function skillConnections(
  skillIds: readonly string[],
): { key: string; skill: string; required: boolean }[] {
  const out: { key: string; skill: string; required: boolean }[] = [];
  for (const id of skillIds) {
    for (const use of skillOf(id)?.uses ?? []) {
      const seen = out.find((c) => c.key === use.key);
      if (!seen) out.push({ key: use.key, skill: id, required: use.required });
      else if (use.required && !seen.required) Object.assign(seen, { skill: id, required: true });
    }
  }
  return out;
}

/** The skill of a list that needs a connection (its "Required by /…"), or null. */
export function requiredBy(skillIds: readonly string[], key: string): string | null {
  return (
    skillIds.find((id) => skillOf(id)?.uses.some((use) => use.key === key && use.required)) ?? null
  );
}

/** What an agent's checks know of its skills now (skills/store.ts agentSkillStates). */
export interface AgentSkillStates {
  /** The GetCito skills the workspace turned off. */
  disabled: ReadonlySet<string>;
  /** The workspace's own skills it names, each true when the person it acts as may run it. */
  workspace: ReadonlyMap<string, boolean>;
}

/**
 * The first of an agent's skills it can't run now, or null (CHAT-21 §G item
 * 34: the agent pauses with skill_off): an GetCito skill the workspace
 * turned off, or a workspace skill that is off, not approved, gone, not the
 * person's to use, or no longer matching its checksum.
 */
export function offAgentSkill(
  skillIds: readonly string[],
  states: AgentSkillStates,
): string | null {
  return (
    skillIds.find((id) =>
      skillOf(id) ? states.disabled.has(id) : states.workspace.get(id) !== true,
    ) ?? null
  );
}
