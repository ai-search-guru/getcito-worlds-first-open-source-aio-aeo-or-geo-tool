/**
 * What the demo brand covers. Every brand-scoped table (one with a
 * `brand_id` column, as the migrations leave it) is either built by a demo
 * module (its `tables`), skipped here with the reason, or pending here with
 * the PR that will build it. coverage.test.js reads the migrations and fails
 * on a table that is in none of these, so a new feature's table can't ship
 * without the demo saying what it shows for it.
 */

/** Tables a demo brand never has rows in, and why. */
export const SKIPPED = {
  cloro_pending_tasks: "Tracking's queue of scraper tasks: a demo brand is never tracked.",
  jobs: 'The tracking and content job queue: no job runs for a demo brand.',
  sent_pulses: 'Pulse e-mails sent: nobody is mailed about a demo brand.',
  pulse_settings:
    'Pulse e-mail settings: a demo brand is never mailed; its settings show the defaults.',
  ai_traffic_digests: 'Weekly AI traffic e-mails sent: never for a demo brand.',
  suggestion_relevance_usage:
    'AI spend on suggestion relevance: nothing is spent for a demo brand.',
  webhook_configs: 'Outgoing webhooks: a demo brand never calls out.',
  prompt_table_views:
    "A person's saved Tracked Prompts columns (00363): the demo brand starts on the default ones.",
  sentiment_overrides:
    "A person's sentiment corrections on Mentions: the demo's answers carry their own.",

  // demo-site
  brand_cms_connections:
    "A CMS connection holds a Composio account's ids, which reach a real CMS account; the demo's Webflow shows as connected from the web's own list (web lib/demo/integrations.ts), and nothing is ever sent.",
  content_draft_deliveries:
    "Drafts sent to a webhook or a CMS: a demo brand never sends anything out (its drafts are the Content module's).",
  catalog_images:
    'Product images: the demo shows none, so no page of it ever loads an image from outside.',
  catalog_orders:
    'A demo brand has no connected merchant store; real orders and refund totals are private purchase history, not feed catalog sample data.',
  catalog_order_items:
    'The demo catalog is built from a public product feed and has no order history; order line items must not imply a merchant’s real purchases.',
  catalog_item_issues:
    "Merchant Center's item issues: the demo's catalog comes from a product feed, and Merchant Center shows as Soon in the demo.",

  // demo-workflows
  action_candidates:
    "The nightly engine's queue of findings not yet raised as actions: no page reads it, and the engine never runs for a demo brand.",
  action_task_runs:
    "The audit trail of the agent's tool runs on a task: no page reads it, and no agent runs for a demo brand.",
  signal_runs:
    "The nightly signal pass's run log (one row per tracking run it covered): no page reads it, and the pass never runs for a demo brand.",
  content_author_defaults:
    "A brand's default author points at one of the organization's own content_authors: the demo adds no people to the person's organization, so its drafts name no author.",
  chat_activity_log:
    "Chat's log of the changes it made (00402): Chat's precedence refuses every change on a demo brand, so none is logged.",
  chat_access_requests:
    "A person's request to their Admins for a Chat change (00403): theirs, not sample data, and a demo brand's refusal offers no Ask your Admin.",
  chat_tool_cache:
    "A chat's reads kept for reuse within it (00410): the server's, from a person's own chat, never sample data.",
  chat_files:
    "Files Chat filed from a person's runs and saved answers (00411): made by their own Chat work, not sample data, and Chat's precedence refuses changes on a demo brand.",
  chat_agent_go_live_events:
    'What agents published or sent on their own (00443): no agent runs for a demo brand, and nothing is ever published or sent for one.',
  chat_notices:
    "A person's notes from the system (00446): one about a brand tells of an agent going live on its own, which never happens for a demo brand.",
  chat_agent_runs:
    "An agent's runs (00419): no trigger fires for a demo brand, and Chat's precedence refuses every change an agent would make on one.",
  chat_why_analyses:
    "Why did it move analyses (00420): made in a person's own chat from their question, not sample data.",
  ship_events:
    "Changes that went live (00421): a demo brand never publishes, and Chat's precedence refuses Mark as shipped on it, so nothing is measured.",
  chat_suggestions: 'Daily suggestions sent (00422): CHAT-26 sends none for a demo brand.',
  chat_suggestion_feeds:
    "A person's daily suggestions switch for a brand (00422): off for a demo brand (CHAT-26 §6).",
  chat_schedules:
    "Chat's scheduled jobs (00457): a person's own, made with a click on a confirm card, and Chat's precedence refuses every change on a demo brand.",
  chat_memory_items:
    "What Chat remembers (00459): saved only with a person's click, never sample data, and Chat's precedence refuses saving on a demo brand.",
  gsc_shopping_page_stats:
    "Search Console's shopping results by page (00377): the sync that reads them never runs for a demo brand, and with the brand's gsc_shopping_synced_at left empty, Readiness shows that item as not read yet and leaves it out of the score.",
  member_brands:
    "The brands shared with a Selected-brands person (00388): the organization's own people, set by its admins; everyone sees the demo brand without a row.",
  agent_conversations:
    "The old Agent chat's conversations (00009): with the new Chat on, the demo brand shows Chat's own sample chats (chat.js) and the old Agent chat page isn't shown.",
  brand_integrations:
    "The sign-in a brand uses per integration (00470): the demo builds none. Like every brand of the Account, the demo brand uses the Account's own Google connection when there is one (nothing is synced for it), and its Webflow shows as connected from the web's own list (web lib/demo/integrations.ts).",
};

const FOLLOW_UP =
  'demo follow-up (PR 7): a draft with product links, checked against the demo catalog';

/** Tables a later demo PR builds; listed so the gap stays visible until then. */
export const PENDING = {
  content_shopping_checks: FOLLOW_UP,

  cited_page_features:
    "demo follow-up (PR 7): what the pages a demo answer cites have (learning C1, 00369); never read for a demo brand, whose tasks don't run",
  competitor_page_events:
    "demo follow-up (PR 7): a demo competitor's pages over time (learning C3, 00376); the nightly read never runs for a demo brand",
  competitor_timeline_scans:
    "demo follow-up (PR 7): when a demo competitor's pages were last read (learning C3, 00376); the nightly read never runs for a demo brand",

  prompt_demand:
    "demo follow-up (PR 7): each demo prompt's demand level (PROMPT-014, 00370); the nightly read never runs for a demo brand",
};

const name = (raw) =>
  raw
    .replace(/"/g, '')
    .replace(/^public\./i, '')
    .toLowerCase();

/** The text of a parenthesized list starting at `open` (the index of its "("). */
function balanced(sql, open) {
  let depth = 0;
  for (let i = open; i < sql.length; i++) {
    if (sql[i] === '(') depth++;
    else if (sql[i] === ')' && --depth === 0) return sql.slice(open + 1, i);
  }
  return sql.slice(open + 1);
}

const BRAND_ID_COLUMN = /(^|[\s,(])"?brand_id"?\s+/i;

/**
 * The tables with a `brand_id` column once the given migrations have run,
 * in order: created with one, given one (`add column brand_id`), losing it,
 * renamed or dropped.
 *
 * @param {string[]} migrations - each migration's SQL, in order
 * @returns {Set<string>}
 */
export function brandScopedTables(migrations) {
  const tables = new Map();
  const statement =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)\s*\(|alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?([\w."]+)\s+([^;]*);|drop\s+table\s+(?:if\s+exists\s+)?([\w.",\s]+?)\s*(?:cascade|restrict)?\s*;/gi;
  for (const migration of migrations) {
    const sql = migration.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of sql.matchAll(statement)) {
      if (m[1]) {
        tables.set(name(m[1]), BRAND_ID_COLUMN.test(balanced(sql, m.index + m[0].length - 1)));
      } else if (m[2]) {
        const table = name(m[2]);
        const rename = m[3].match(/^rename\s+to\s+([\w."]+)/i);
        if (rename) {
          const had = tables.get(table);
          tables.delete(table);
          tables.set(name(rename[1]), had);
        } else if (/add\s+column\s+(?:if\s+not\s+exists\s+)?"?brand_id"?\s/i.test(m[3])) {
          tables.set(table, true);
        } else if (/drop\s+column\s+(?:if\s+exists\s+)?"?brand_id"?/i.test(m[3])) {
          tables.set(table, false);
        }
      } else if (m[4]) {
        for (const table of m[4].split(',')) tables.delete(name(table.trim()));
      }
    }
  }
  return new Set([...tables].filter(([, hasBrandId]) => hasBrandId).map(([table]) => table));
}
