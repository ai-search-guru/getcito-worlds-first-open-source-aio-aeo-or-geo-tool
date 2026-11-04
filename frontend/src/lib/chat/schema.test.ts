// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHAT_MODES } from './precedence';
import { WHY_METRICS } from './why/explain';

/**
 * Chat’s Wave 1 (00407–00413), Wave 2 (00417–00423), Wave 3 (00457–00459)
 * and Wave 4 (00462–00467) tables as the migrations leave them: who reads
 * them, what stays with the server, and the limits the specs set. Read from
 * the SQL, as events.test.ts reads the step kinds: the repository has no
 * database tests.
 */

const dir = fileURLToPath(new URL('../../../../supabase/migrations', import.meta.url));
const files = readdirSync(dir)
  .filter((file) => file.endsWith('.sql'))
  .sort();

/** A migration's SQL, without its comments. */
function migration(number: string): string {
  const file = files.find((name) => name.startsWith(`${number}_`));
  if (!file) throw new Error(`No migration ${number}`);
  return readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, '');
}

const WAVE_1 = ['00407', '00408', '00409', '00410', '00411', '00412', '00413'];
const sql = WAVE_1.map(migration).join('\n');

/** The tables the wave creates. */
const created = [...sql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** Tables no member reads: tool names, model costs and anonymous logs. */
const SERVER_ONLY = [
  'chat_tool_cache',
  'help_answer_cache',
  'help_gaps',
  'add_on_products',
  'ai_credit_grants',
  'storage_grants',
];

/** A bucket the migrations create: private or not, its size limit and types. */
function bucket(id: string) {
  const m = sql.match(
    new RegExp(
      `insert into storage\\.buckets[^;]*?values\\s*\\(\\s*'${id}',\\s*'${id}',\\s*(true|false),\\s*(\\d+),\\s*array\\[([^\\]]*)\\]`,
    ),
  );
  if (!m) throw new Error(`No bucket ${id}`);
  return {
    public: m[1] === 'true',
    sizeLimit: Number(m[2]),
    types: [...m[3].matchAll(/'([^']+)'/g)].map((t) => t[1]),
  };
}

/** A policy's text, from its name to the end of its statement. */
function policy(name: string, from = sql): string {
  const m = from.match(new RegExp(`create policy "${name}"[^;]*;`));
  if (!m) throw new Error(`No policy ${name}`);
  return m[0].replace(/\s+/g, ' ');
}

describe('Wave 1 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created.sort()).toEqual(
      [
        'chat_uploads',
        'chat_tool_cache',
        'chat_files',
        'chat_file_task_links',
        'chat_storage_usage',
        'help_answer_cache',
        'help_gaps',
        'add_on_products',
        'add_on_purchases',
        'ai_credit_grants',
        'storage_grants',
      ].sort(),
    );
  });

  it('turns row level security on for each of them', () => {
    for (const table of created) {
      expect(sql, table).toMatch(
        new RegExp(`alter table public\\.${table} enable row level security`),
      );
    }
  });

  it('lets members read at most: every write is the server’s', () => {
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(sql).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
  });

  it('keeps tool results, Help logs and the dollars of packs and grants from members', () => {
    for (const table of SERVER_ONLY) {
      expect(sql, table).not.toMatch(
        new RegExp(`grant [^;]*on table public\\.${table} to authenticated`),
      );
      expect(sql, table).not.toMatch(new RegExp(`create policy [^;]*on public\\.${table}\\b`));
    }
  });
});

describe('chats', () => {
  it('shows a chat to its author, or to its workspace once shared, and to nobody once deleted', () => {
    const author = policy('chat_conversations: author select');
    const shared = policy('chat_conversations: shared select');
    expect(author).toContain('user_id = auth.uid()');
    expect(shared).toContain('shared_at is not null');
    expect(shared).not.toContain('user_id = auth.uid()');
    for (const text of [author, shared]) {
      expect(text).toContain('deleted_at is null');
      expect(text).toContain(
        'select p.organization_id from public.profiles p where p.id = auth.uid()',
      );
    }
  });

  it('keeps what a message was scoped to on the person’s messages only', () => {
    expect(migration('00407')).toMatch(/check \(context_json is null or role = 'user'\)/);
  });

  it('searches titles and messages in any language', () => {
    const chats = migration('00407');
    expect(chats).toMatch(/to_tsvector\('simple', coalesce\(title, ''\)\)/);
    expect(chats).toMatch(/to_tsvector\('simple', content_md\)/);
    expect(chats).toMatch(/chat_conversations using gin \(search_tsv\)/);
    expect(chats).toMatch(/chat_messages using gin \(search_tsv\)/);
  });
});

describe('a person’s Chat settings', () => {
  it('start a chat in one of the composer’s modes', () => {
    const check = migration('00408').match(/default_mode in \(([^)]*)\)/)?.[1] ?? '';
    expect([...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1])).toEqual([...CHAT_MODES]);
  });
});

describe('attachments', () => {
  const uploads = migration('00409');

  it('are private, 10 MB each, in the types the composer offers', () => {
    const chatUploads = bucket('chat-uploads');
    expect(chatUploads.public).toBe(false);
    expect(chatUploads.sizeLimit).toBe(10 * 1024 * 1024);
    expect(uploads).toMatch(
      /size_bytes integer not null check \(size_bytes between 1 and 10485760\)/,
    );
    const column = uploads.match(/mime_type in \(([^)]*)\)/)?.[1] ?? '';
    expect([...column.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual(chatUploads.types);
    expect(chatUploads.types).toHaveLength(11);
  });

  it('are 5 a message at most, kept 90 days', () => {
    expect(uploads).toMatch(/\) >= 5/);
    expect(uploads).toMatch(/before insert or update of message_id on public\.chat_uploads/);
    expect(uploads).toMatch(
      /expires_at timestamptz not null default \(now\(\) \+ interval '90 days'\)/,
    );
  });
});

describe('Files', () => {
  const chatFiles = migration('00411');

  it('are private to the workspace and kept a year', () => {
    expect(bucket('chat-files').public).toBe(false);
    expect(chatFiles).toMatch(
      /expires_at timestamptz not null default \(now\(\) \+ interval '1 year'\)/,
    );
    expect(policy('chat_files: member select')).toContain(
      'organization_id in ( select p.organization_id from public.profiles p where p.id = auth.uid() )',
    );
  });

  it('count every file written, resized or deleted toward the workspace’s storage', () => {
    expect(chatFiles).toMatch(
      /after insert or delete or update of size_bytes on public\.chat_files\s+for each row execute function public\.chat_files_count_storage\(\)/,
    );
  });
});

describe('add-on packs', () => {
  const packs = [
    ...migration('00413').matchAll(
      /\(\s*'(\w+)',\s*'(ai|storage)',\s*'[^']*',\s*(\d+),\s*'(\w+)',\s*(\d+|null),\s*(\d+|null),\s*(\d+|null),\s*(true|false),\s*\d+\s*\)/g,
    ),
  ].map(([, id, kind, cents, billing, usd, bytes, months, highlight]) => ({
    id,
    kind,
    cents: Number(cents),
    billing,
    usd: usd === 'null' ? null : Number(usd),
    bytes: bytes === 'null' ? null : Number(bytes),
    months: months === 'null' ? null : Number(months),
    highlight: highlight === 'true',
  }));
  const GB = 1024 ** 3;

  it('sell AI credits at $10, $50, $250 and $1,000: half the price as budget, valid 12 months', () => {
    const ai = packs.filter((pack) => pack.kind === 'ai');
    expect(ai.map((pack) => pack.cents)).toEqual([1000, 5000, 25000, 100000]);
    for (const pack of ai) {
      expect(pack.usd).toBe(pack.cents / 100 / 2);
      expect(pack).toMatchObject({ billing: 'one_time', months: 12, bytes: null });
    }
  });

  it('sell storage monthly: +25 GB $5, +100 GB $15, +250 GB $29', () => {
    const storage = packs.filter((pack) => pack.kind === 'storage');
    expect(storage.map((pack) => [pack.bytes, pack.cents])).toEqual([
      [25 * GB, 500],
      [100 * GB, 1500],
      [250 * GB, 2900],
    ]);
    for (const pack of storage) {
      expect(pack).toMatchObject({ billing: 'monthly', months: null, usd: null });
    }
  });

  it('mark $50 and +25 GB as Most picked', () => {
    expect(packs.filter((pack) => pack.highlight).map((pack) => pack.id)).toEqual([
      'ai_50',
      'storage_25',
    ]);
  });

  it('show purchases to the workspace’s Admins only', () => {
    expect(policy('add_on_purchases: admin select')).toContain(
      "where p.id = auth.uid() and p.role = 'admin'",
    );
  });

  it('tie a ledger row to the grant it drew on', () => {
    expect(migration('00413')).toMatch(
      /alter table public\.prompt_improve_usage\s+add column if not exists grant_id uuid\s+references public\.ai_credit_grants\(id\) on delete set null/,
    );
  });
});

const WAVE_2 = ['00417', '00418', '00419', '00420', '00421', '00422', '00423'];
const wave2 = WAVE_2.map(migration).join('\n');

/** The tables Wave 2 creates. */
const created2 = [...wave2.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** A table's create statement, from its name to its closing parenthesis. */
function table(name: string): string {
  const m = wave2.match(
    new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) throw new Error(`No table ${name}`);
  return m[1];
}

/** The values a column's check allows, in order. */
function allowed(text: string, column: string): string[] {
  const m = text.match(new RegExp(`\\b${column} in \\(([^)]*)\\)`));
  if (!m) throw new Error(`No check on ${column}`);
  return [...m[1].matchAll(/'([a-z0-9_]+)'/g)].map((v) => v[1]);
}

/** The one outcome vocabulary (decision 13, CHAT-22 shared rule 3). */
const OUTCOMES = ['pending', 'improved', 'no_meaningful_change', 'declined', 'not_measurable'];

describe('Wave 2 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created2.sort()).toEqual(
      [
        'chat_asks',
        'chat_next_moves',
        'chat_task_state',
        'chat_agents',
        'chat_agent_versions',
        'chat_agent_triggers',
        'chat_agent_runs',
        'chat_why_analyses',
        'ship_events',
        'impact_measurements',
        'impact_control_sets',
        'chat_suggestion_feeds',
        'chat_suggestions',
      ].sort(),
    );
  });

  it('turns row level security on for each of them', () => {
    for (const name of created2) {
      expect(wave2, name).toMatch(
        new RegExp(`alter table public\\.${name} enable row level security`),
      );
    }
  });

  it('lets members read at most: every write is the server’s', () => {
    expect(wave2).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(wave2).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
  });

  it('keeps the agent queue, the holds, the agents’ shares and Why’s counts with the server', () => {
    for (const fn of [
      'chat_start_next_agent_run',
      'reserve_chat_ai_usage',
      'chat_agent_usage_shares',
      'chat_why_cells',
    ]) {
      expect(wave2, fn).toMatch(
        new RegExp(
          `revoke all on function public\\.${fn}\\([^)]*\\)\\s+from public, anon, authenticated`,
        ),
      );
      expect(wave2, fn).not.toMatch(
        new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\)\\s+to authenticated`),
      );
    }
  });
});

describe('Why’s counts (00423)', () => {
  const why = migration('00423');

  it('read as the caller, on a pinned search path, and change nothing', () => {
    expect(why).toMatch(/create or replace function public\.chat_why_cells\(/);
    expect(why).not.toMatch(/security definer/);
    expect(why).toMatch(/\bstable\b/);
    expect(why).toMatch(/set search_path = ''/);
    expect(why).not.toMatch(/\b(insert into|update public|delete from)\b/);
    expect(why).toMatch(
      /grant execute on function public\.chat_why_cells\([^)]*\)\s+to service_role/,
    );
  });

  it('read 92 days at most a call, period a before period b', () => {
    expect(why).toMatch(/p_a_from > p_a_to or p_b_from > p_b_to/);
    expect(why).toMatch(/p_a_to >= p_b_from/);
    expect(why).toMatch(/p_series_from > p_b_to/);
    expect(why).toMatch(
      /p_a_to - p_a_from > 92 or p_b_to - p_b_from > 92 or p_b_to - p_series_from > 92/,
    );
  });

  it('read both rollups by brand and day, and sum the competitors on their own', () => {
    for (const table of ['insights_prompt_daily d', 'insights_competitor_prompt_daily c']) {
      expect(why).toContain(`from public.${table}`);
    }
    expect(why.match(/\.brand_id = p_brand_id/g)).toHaveLength(2);
    expect(why.match(/day between p_series_from and p_b_to\)/g)).toHaveLength(2);
    // Grouped before they meet: one row a side, so no join repeats a count.
    expect(why).toMatch(/competitor_cells as \([\s\S]*?group by/);
    expect(why).toMatch(/left join competitor_cells c/);
    // Share of voice and visibility as Insights counts them, and whether old rows were read.
    expect(why).toContain('sum(r.total_mentions)');
    expect(why).toContain('sum(r.mention_count)');
    expect(why).toMatch(
      /count\(distinct r\.prompt_id\) filter \(where r\.has_mention or r\.has_citation\)/,
    );
    expect(why).toMatch(/'complete', not exists/);
    expect(why).toContain("'[]'::jsonb");
  });

  it('return the Visibility score’s position factor, per cell and per day', () => {
    // Insights' Visibility card: 0.6 × mention rate + 0.25 × citation rate +
    // 0.15 × (sum of 1/position ÷ positions), as ai_visibility_aggregates_daily.
    expect(why.match(/sum\(r\.sum_inv_position\) as sum_inv_position/g)).toHaveLength(2);
    expect(why.match(/'sum_inv_position', b\.sum_inv_position/g)).toHaveLength(2);
  });

  it('read each rollup on one day range of its (brand_id, day) index', () => {
    for (const t of ['d', 'c']) {
      expect(why).toContain(`and ${t}.day between least(p_a_from, p_series_from) and p_b_to`);
    }
  });
});

describe('Why analyses (00420, 00427)', () => {
  it('keep every metric explain_change explains, the Visibility score too', () => {
    // The last migration that sets the metric check is the one in force.
    const sets = files.filter((file) =>
      /chat_why_analyses[\s\S]*metric in \(/.test(
        readFileSync(`${dir}/${file}`, 'utf8').replace(/--[^\n]*/g, ''),
      ),
    );
    const latest = migration(sets[sets.length - 1].slice(0, 5));
    expect(allowed(latest, 'metric').sort()).toEqual([...WHY_METRICS].sort());
  });
});

describe('questions and next moves', () => {
  const asks = table('chat_asks');
  const moves = table('chat_next_moves');

  it('ask at most 4 questions a run, in order', () => {
    expect(asks).toMatch(/position smallint not null check \(position between 1 and 4\)/);
    expect(asks).toMatch(/unique \(run_id, position\)/);
  });

  it('give each question 2–4 options with exactly one Recommended', () => {
    const fn = migration('00417');
    expect(fn).toMatch(/jsonb_array_length\(p_options\) not between 2 and 4 then false/);
    expect(fn).toMatch(/count\(\*\) filter \(where o -> 'recommended' = 'true'::jsonb\) = 1/);
    expect(asks).toMatch(/public\.chat_ask_options_valid\(options_json\)/);
  });

  it('rank 2–4 moves whose prompts fit as ghost text, each with its action class', () => {
    expect(moves).toMatch(/rank smallint not null check \(rank between 1 and 4\)/);
    expect(moves).toMatch(/prompt text not null check \(char_length\(prompt\) between 1 and 80\)/);
    expect(allowed(moves, 'class')).toEqual(['read', 'write', 'execute']);
  });

  it('keep the shortcut on the person’s message only', () => {
    expect(migration('00417')).toMatch(/check \(shortcut_id is null or role = 'user'\)/);
  });
});

describe('the task strip', () => {
  it('holds Chat’s own status, never the task’s Action Center one', () => {
    const strip = table('chat_task_state');
    expect(allowed(strip, 'chat_status')).toEqual([
      'queued',
      'writing',
      'ready_for_review',
      'done',
    ]);
    expect(migration('00418')).not.toMatch(/alter table public\.action_tasks/);
  });
});

describe('agents', () => {
  const agents = table('chat_agents');
  const versions = table('chat_agent_versions');
  const runs = table('chat_agent_runs');
  const agentSql = migration('00419');

  it('go draft, active, paused, archived, with a reason when paused', () => {
    expect(allowed(agents, 'status')).toEqual(['draft', 'active', 'paused', 'archived']);
    expect(allowed(agents, 'paused_reason')).toEqual([
      'cap',
      'connection',
      'skill_off',
      'failures',
      'owner_role',
      'plan',
      'brand_gone',
      'manual',
    ]);
    expect(agents).toMatch(/check \(\(status = 'paused'\) = \(paused_reason is not null\)\)/);
  });

  it('run in one of the composer’s modes, with 1–3 skills and no key', () => {
    expect(allowed(versions, 'mode')).toEqual([...CHAT_MODES]);
    expect(versions).toMatch(/cardinality\(skill_ids\) between 1 and 3/);
    expect(`${agents}\n${versions}`).not.toMatch(/key_encrypted|api_key/);
  });

  it('cap a run at 10% of the AI limit by default, 1–50%', () => {
    expect(agents).toMatch(
      /max_run_share numeric\(3, 2\) not null default 0\.10 check \(max_run_share between 0\.01 and 0\.50\)/,
    );
    expect(agentSql).toMatch(
      /agent_run_share_default numeric\(3, 2\) not null default 0\.10\s+check \(agent_run_share_default between 0\.01 and 0\.50\)/,
    );
  });

  it('keep CHAT-21’s run statuses, queued and skipped included', () => {
    expect(allowed(runs, 'status')).toEqual([
      'queued',
      'running',
      'needs_you',
      'done',
      'failed',
      'stopped',
      'skipped',
      'paused_cap',
    ]);
    expect(allowed(runs, 'outcome')).toEqual(OUTCOMES);
  });

  it('run one at a time per agent and brand, a run paused at its cap keeping its place', () => {
    expect(agentSql).toMatch(
      /on public\.chat_agent_runs \(agent_id, brand_id\)\s+where status in \('running', 'needs_you', 'paused_cap'\)/,
    );
  });

  it('start a queued run only for a live agent and brand, within the workspace limit', () => {
    const start = agentSql.slice(agentSql.indexOf('function public.chat_start_next_agent_run'));
    expect(start).toContain("raise exception 'a workspace limit is needed'");
    expect(start).toContain('q.brand_id is not null');
    expect(start).toContain("g.status <> 'archived'");
    expect(start).toContain("(g.status = 'active' or q.trigger_kind in ('manual', 'action'))");
  });

  it("hold a step against the chat's own agent run, so subtasks count toward it", () => {
    const reserve = agentSql.slice(agentSql.indexOf('function public.reserve_chat_ai_usage'));
    expect(reserve).toContain(
      'select r.parent_run_id, c.agent_run_id into v_parent_id, v_agent_run',
    );
    expect(reserve).toContain("raise exception 'agent run is not the chat''s'");
    expect(reserve).toMatch(/set search_path = ''/);
  });

  it('show a run’s chat to whoever reads the run, never once deleted', () => {
    const text = policy('chat_conversations: agent run select', agentSql);
    expect(text).toContain('agent_run_id in (select r.id from public.chat_agent_runs r)');
    expect(text).toContain('deleted_at is null');
  });

  it('show a private agent to its owner and the Admins only', () => {
    const text = policy('chat_agents: member select', agentSql);
    expect(text).toContain("p.role = 'admin'");
    expect(text).toContain("chat_agents.visibility = 'workspace'");
    expect(text).toContain('chat_agents.owner_id = auth.uid()');
  });

  it('give a subtask no message of its own, one level deep', () => {
    expect(agentSql).toMatch(/\(parent_run_id is null\) = \(message_id is not null\)/);
    expect(agentSql).toMatch(/and p\.parent_run_id is null/);
    expect(agentSql).toMatch(/\) >= 10 then/);
  });

  it('keep the server’s hold arguments, adding the agent run and its cap', () => {
    const fn = agentSql.match(
      /create or replace function public\.reserve_chat_ai_usage\(([^)]*)\)/,
    )?.[1];
    const names = [...(fn ?? '').matchAll(/(p_\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'p_organization_id',
      'p_chat_run_id',
      'p_chat_run_step_id',
      'p_feature',
      'p_model',
      'p_cost',
      'p_own_key',
      'p_since',
      'p_budget',
      'p_agent_run_id',
      'p_run_cap',
    ]);
    expect(fn).toMatch(/p_agent_run_id\s+uuid default null/);
    expect(fn).toMatch(/p_run_cap\s+numeric default null/);
  });

  it('give each agent’s spend as shares, never as costs', () => {
    expect(agentSql).toMatch(
      /returns table \(agent_id uuid, share numeric, own_key_share numeric, runs integer\)/,
    );
  });
});

describe('the impact ledger', () => {
  const measurements = table('impact_measurements');

  it('measures each ship event once, in the one outcome vocabulary', () => {
    expect(measurements).toMatch(
      /ship_event_id uuid not null unique references public\.ship_events\(id\)/,
    );
    expect(allowed(measurements, 'outcome')).toEqual(OUTCOMES);
    expect(allowed(measurements, 'confidence')).toEqual(['low', 'medium', 'high']);
  });

  it('checks at 7, 14, 30 and 90 days', () => {
    for (const name of ['impact_measurements', 'impact_control_sets']) {
      expect(allowed(table(name), 'checkpoint'), name).toEqual(['d7', 'd14', 'd30', 'd90']);
    }
  });

  it('is read by every member of the workspace', () => {
    expect(policy('ship_events: member select', wave2)).toContain(
      'organization_id in ( select p.organization_id from public.profiles p where p.id = auth.uid() )',
    );
  });

  it('writes one ship event per CMS send, and notes a page published again (00425)', () => {
    const delivery = migration('00425');
    expect(delivery).toMatch(
      /add column if not exists content_draft_delivery_id uuid\s+references public\.content_draft_deliveries\(id\) on delete set null/,
    );
    expect(delivery).toMatch(/add column if not exists republished_at timestamptz/);
    // A plain unique index: PostgREST's on_conflict can't name a partial one's predicate.
    expect(delivery).toMatch(
      /create unique index if not exists ship_events_content_draft_delivery_uidx\s+on public\.ship_events \(content_draft_delivery_id\);/,
    );
    expect(delivery).not.toMatch(/grant [^;]*to authenticated/);
  });

  it('decides a CMS publish under a lock on its draft, into a cms_publish only (00428)', () => {
    const ship = migration('00428');
    expect(ship).toMatch(
      /pg_advisory_xact_lock\(hashtext\('ship_cms_publish:' \|\| p_content_draft_id::text\)\)/,
    );
    // The window is the server's (REPUBLISH_DAYS), passed in: set in one place.
    expect(ship).toMatch(
      /and s\.kind = 'cms_publish'\s+and s\.shipped_at >= p_shipped_at - make_interval\(days => p_republish_days\)\s+and s\.shipped_at <= p_shipped_at \+ make_interval\(days => p_republish_days\)/,
    );
    expect(ship).toMatch(/p_execution_mode text,\s+p_republish_days integer\s*\)/);
    expect(ship).not.toMatch(/interval '\d+ days'/);
    // The latest before the send first, else the nearest after it.
    expect(ship).toMatch(
      /order by s\.shipped_at > p_shipped_at,\s+greatest\(s\.shipped_at - p_shipped_at, p_shipped_at - s\.shipped_at\)/,
    );
    expect(ship).toMatch(/on conflict \(content_draft_delivery_id\) do nothing/);
    expect(ship).toMatch(/set search_path = ''/);
    expect(ship).toMatch(
      /revoke all on function public\.ship_cms_publish\([^)]*\)\s+from public, anon, authenticated;/,
    );
    expect(ship).toMatch(
      /grant execute on function public\.ship_cms_publish\([^)]*\)\s+to service_role;/,
    );
    expect(ship).toMatch(/check \(cardinality\(republished_delivery_ids\) <= 50\)/);
  });

  it('finds a send noted on a cms_publish by its id, before the draft lookup (00428)', () => {
    const ship = migration('00428');
    // A deleted draft sets content_draft_id null: only the noted ids tie the send to it.
    const noted = ship.indexOf('where s.republished_delivery_ids @> array[p_delivery_id]');
    expect(noted).toBeGreaterThan(-1);
    expect(noted).toBeLessThan(ship.indexOf('and s.content_draft_id = p_content_draft_id'));
    expect(ship).toMatch(
      /create index if not exists ship_events_republished_delivery_ids_idx\s+on public\.ship_events using gin \(republished_delivery_ids\);/,
    );
  });
});

describe('daily suggestions', () => {
  it('send at most one a day per person and brand', () => {
    expect(table('chat_suggestions')).toMatch(/unique \(user_id, brand_id, sent_on\)/);
  });

  it('show a person only their own', () => {
    for (const name of ['chat_suggestions: own select', 'chat_suggestion_feeds: own select']) {
      expect(policy(name, wave2)).toContain('user_id = auth.uid()');
    }
  });
});

const WAVE_3 = ['00457', '00458', '00459'];
const wave3 = WAVE_3.map(migration).join('\n');

/** The tables Wave 3 creates. */
const created3 = [...wave3.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** A Wave 3 table's create statement, from its name to its closing parenthesis. */
function table3(name: string): string {
  const m = wave3.match(
    new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) throw new Error(`No table ${name}`);
  return m[1];
}

/** A function's body in `text`, from its create statement to its closing $$. */
function body(text: string, fn: string): string {
  const start = text.indexOf(`create or replace function public.${fn}(`);
  if (start < 0) throw new Error(`No function ${fn}`);
  const open = text.indexOf('$$', start);
  return text.slice(start, text.indexOf('$$', open + 2));
}

describe('Wave 3 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created3.sort()).toEqual(
      ['chat_schedules', 'chat_schedule_runs', 'chat_skills', 'chat_memory_items'].sort(),
    );
  });

  it('turns row level security on for each of them', () => {
    for (const name of created3) {
      expect(wave3, name).toMatch(
        new RegExp(`alter table public\\.${name} enable row level security`),
      );
    }
  });

  it('lets members read at most, and anon nothing: every write is the server’s', () => {
    expect(wave3).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(wave3).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
    expect(wave3).not.toMatch(/grant [^;]*to anon/);
    for (const name of created3) {
      expect(wave3, name).toMatch(
        new RegExp(`revoke all on table public\\.${name} from anon, authenticated`),
      );
      expect(wave3, name).toMatch(
        new RegExp(`grant select on table public\\.${name} to authenticated`),
      );
      expect(wave3, name).toMatch(
        new RegExp(`grant all on table public\\.${name} to service_role`),
      );
    }
  });

  it('gives each policy to signed-in people only', () => {
    const policies = [...wave3.matchAll(/create policy "[^"]+"[^;]*;/g)].map((m) =>
      m[0].replace(/\s+/g, ' '),
    );
    expect(policies).toHaveLength(6);
    for (const text of policies) expect(text).toContain('for select to authenticated using');
  });

  it('keeps the hold with the server', () => {
    expect(wave3).toMatch(
      /revoke all on function public\.reserve_chat_ai_usage\([^)]*\)\s+from public, anon, authenticated/,
    );
    expect(wave3).not.toMatch(/grant execute on function [^;]*to authenticated/);
  });
});

describe('scheduled jobs (00457)', () => {
  const jobs = table3('chat_schedules');
  const runs = table3('chat_schedule_runs');
  const jobSql = migration('00457');

  it('run once, on repeat or as a follow-up check, at a time or ready by it', () => {
    expect(allowed(jobs, 'kind')).toEqual(['once', 'recurring', 'followup_check']);
    expect(allowed(jobs, 'run_mode')).toEqual(['run_at', 'ready_by']);
    expect(jobs).toMatch(/check \(\(kind = 'recurring'\) = \(rrule is not null\)\)/);
    expect(jobs).toMatch(/check \(run_mode = 'run_at' or kind = 'once'\)/);
    expect(jobs).toMatch(/check \(not change_only or kind = 'recurring'\)/);
  });

  it('run in one of the composer’s modes, off only with a reason', () => {
    expect(allowed(jobs, 'mode')).toEqual([...CHAT_MODES]);
    expect(allowed(jobs, 'paused_reason')).toEqual([
      'cap',
      'failed',
      'skill_off',
      'missing_source',
      'owner_role',
      'manual',
    ]);
    expect(jobs).toMatch(/check \(enabled = \(paused_reason is null\)\)/);
  });

  it('deliver to Chat, email or both, emailing people of the workspace only', () => {
    expect(jobs).toMatch(/deliver_to <@ array\['chat', 'email'\]::text\[\]/);
    expect(jobs).toMatch(/recipient_ids uuid\[\]/);
    const check = body(jobSql, 'chat_schedules_check_recipients');
    expect(check).toContain('p.id = r.id and p.organization_id = new.organization_id');
    expect(jobSql).toMatch(
      /before insert or update of recipient_ids, organization_id on public\.chat_schedules/,
    );
  });

  it('let only a Full auto run set a follow-up check by itself', () => {
    expect(allowed(jobs, 'created_via')).toEqual(['card', 'full_auto']);
    expect(jobs).toMatch(/check \(created_via = 'card' or kind = 'followup_check'\)/);
  });

  it('turn a job off once its brand or its creator is gone', () => {
    expect(jobs).toMatch(/brand_id uuid references public\.brands\(id\) on delete set null/);
    const gone = body(jobSql, 'chat_schedules_source_gone');
    expect(gone).toContain("new.paused_reason := 'missing_source'");
    expect(gone).toContain("new.paused_reason := 'owner_role'");
    expect(jobSql).toMatch(/before update of brand_id, created_by on public\.chat_schedules/);
  });

  it('keep run statuses, and never run a slot twice', () => {
    expect(allowed(runs, 'status')).toEqual([
      'running',
      'done',
      'unchanged',
      'failed',
      'paused_cap',
      'skipped',
      'needs_you',
    ]);
    expect(runs).toMatch(/attempt smallint not null default 1 check \(attempt between 1 and 2\)/);
    expect(jobSql).toMatch(
      /create unique index if not exists chat_schedule_runs_slot_uidx\s+on public\.chat_schedule_runs \(schedule_id, slot_at, attempt\)/,
    );
    expect(runs).toMatch(/usage_share numeric\(7, 4\)/);
    expect(runs).not.toMatch(/cost_usd/);
  });

  it('give each job one live chat of origin schedule, still its creator’s', () => {
    expect(jobSql).toMatch(/check \(origin in \('page', 'panel', 'agent', 'schedule'\)\)/);
    expect(jobSql).toMatch(
      /on public\.chat_conversations \(schedule_id\)\s+where schedule_id is not null and deleted_at is null/,
    );
    expect(jobSql).not.toMatch(/create policy [^;]*on public\.chat_conversations\b/);
  });

  it('show a job to its creator and the Admins, within the brands they can access', () => {
    const text = policy('chat_schedules: own or admin select', jobSql);
    expect(text).toContain("p.role = 'admin' or chat_schedules.created_by = auth.uid()");
    expect(text).toContain('brand_id is null or brand_id in (select public.user_brand_ids())');
    expect(policy('chat_schedule_runs: schedule select', jobSql)).toContain(
      'schedule_id in (select s.id from public.chat_schedules s)',
    );
  });

  it('name a spend row by the chat’s job, old calls still matching', () => {
    expect(jobSql).toMatch(
      /alter table public\.prompt_improve_usage\s+add column if not exists schedule_id uuid\s+references public\.chat_schedules\(id\) on delete set null/,
    );
    const fn = jobSql.match(
      /create or replace function public\.reserve_chat_ai_usage\(([^)]*)\)/,
    )?.[1];
    const names = [...(fn ?? '').matchAll(/(p_\w+)/g)].map((m) => m[1]);
    expect(names).toEqual([
      'p_organization_id',
      'p_chat_run_id',
      'p_chat_run_step_id',
      'p_feature',
      'p_model',
      'p_cost',
      'p_own_key',
      'p_since',
      'p_budget',
      'p_agent_run_id',
      'p_run_cap',
      'p_schedule_id',
    ]);
    expect(fn).toMatch(/p_schedule_id\s+uuid default null/);
    // The old signature goes first, or both would match an old call.
    expect(jobSql).toMatch(
      /drop function if exists public\.reserve_chat_ai_usage\(\s*uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric, uuid, numeric\s*\);/,
    );
    const reserve = body(jobSql, 'reserve_chat_ai_usage');
    expect(reserve).toContain('select r.parent_run_id, c.agent_run_id, c.schedule_id');
    expect(reserve).toContain("raise exception 'schedule is not the chat''s'");
    expect(reserve).toContain("raise exception 'agent run is not the chat''s'");
    expect(reserve).toMatch(/v_agent_id, v_agent_run, v_parent_id, v_schedule\)/);
    expect(reserve).toMatch(/set search_path = ''/);
  });
});

describe('workspace skills (00458)', () => {
  const skills = table3('chat_skills');
  const skillSql = migration('00458');

  it('take a name once in the workspace, in the format’s rules', () => {
    expect(skills).toMatch(/name ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
    expect(skills).toMatch(/char_length\(name\) <= 64/);
    expect(skills).toMatch(/unique \(organization_id, name\)/);
    expect(skills).toMatch(/char_length\(description\) between 1 and 1024/);
  });

  it('keep a body to 50 KB', () => {
    expect(skills).toMatch(/octet_length\(body\) <= 51200/);
  });

  it('import only under the licenses the owner accepted', () => {
    const licenses = skills.match(/license in \(([^)]*)\)/)?.[1] ?? '';
    expect([...licenses.matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([
      'MIT',
      'Apache-2.0',
      'BSD-2-Clause',
      'BSD-3-Clause',
      'ISC',
    ]);
    expect(skills).toMatch(/check \(source = 'user' or license is not null\)/);
    expect(allowed(skills, 'source')).toEqual(['user', 'import']);
  });

  it('turn on only once approved, a blocked one never', () => {
    expect(allowed(skills, 'status')).toEqual([
      'pending_review',
      'approved',
      'rejected',
      'blocked',
    ]);
    expect(skills).toMatch(/check \(not enabled or status = 'approved'\)/);
    expect(allowed(skills, 'visibility')).toEqual(['private', 'workspace']);
  });

  it('pin an import to its commit and checksum', () => {
    expect(skills).toMatch(/commit_sha text check \(commit_sha ~ '\^\[0-9a-f\]\{40\}\$'\)/);
    expect(skills).toMatch(
      /checksum_sha256 text not null check \(checksum_sha256 ~ '\^\[0-9a-f\]\{64\}\$'\)/,
    );
  });

  it('show a private or unapproved skill to its creator and the Admins only', () => {
    const text = policy('chat_skills: member select', skillSql);
    expect(text).toContain("p.role = 'admin'");
    expect(text).toContain('chat_skills.created_by = auth.uid()');
    expect(text).toContain(
      "(chat_skills.visibility = 'workspace' and chat_skills.status = 'approved')",
    );
  });

  it('let a workspace turn library skills off by name', () => {
    expect(skillSql).toMatch(
      /alter table public\.chat_settings\s+add column if not exists disabled_skills text\[\] not null default '\{\}'/,
    );
  });
});

describe('memory (00459)', () => {
  const memory = table3('chat_memory_items');
  const memorySql = migration('00459');

  it('keeps a person’s, a brand’s and the workspace’s lines, 300 characters each', () => {
    expect(allowed(memory, 'scope')).toEqual(['user', 'brand', 'workspace']);
    expect(allowed(memory, 'source')).toEqual(['profile', 'chat', 'page']);
    expect(memory).toMatch(/text text not null check \(char_length\(text\) between 1 and 300\)/);
    expect(memory).toMatch(/check \(\(scope = 'user'\) = \(user_id is not null\)\)/);
    expect(memory).toMatch(/check \(\(scope = 'brand'\) = \(brand_id is not null\)\)/);
  });

  it('holds 4,000 characters a scope under a lock, deleted lines left out', () => {
    const limit = body(memorySql, 'chat_memory_items_scope_limit');
    expect(limit).toContain('pg_advisory_xact_lock');
    expect(limit).toContain('v_used + char_length(new.text) > 4000');
    expect(limit).toContain('and m.deleted_at is null');
    expect(memorySql).toMatch(
      /before insert or update of text, scope, organization_id, user_id, brand_id, deleted_at\s+on public\.chat_memory_items/,
    );
  });

  it('lets a brand’s lines go with the brand, and a person’s Me lines with their leaving', () => {
    expect(memory).toMatch(/brand_id uuid references public\.brands\(id\) on delete cascade/);
    expect(memory).toMatch(/user_id uuid references auth\.users\(id\) on delete cascade/);
    const forget = body(memorySql, 'forget_profile_chat_memory');
    expect(forget).toContain("and m.scope = 'user'");
    expect(forget).toContain('and m.organization_id is distinct from new.organization_id');
    expect(memorySql).toMatch(
      /after update of organization_id on public\.profiles\s+for each row\s+when \(old\.organization_id is distinct from new\.organization_id\)/,
    );
    expect(memorySql).toMatch(
      /revoke all on function public\.forget_profile_chat_memory\(\) from public, anon, authenticated/,
    );
  });

  it('shows Me only to its person, a brand’s lines by brand access, deleted lines to nobody', () => {
    const own = policy('chat_memory_items: own select', memorySql);
    const brand = policy('chat_memory_items: brand select', memorySql);
    const workspace = policy('chat_memory_items: workspace select', memorySql);
    expect(own).toContain("scope = 'user' and user_id = auth.uid()");
    expect(own).not.toContain("p.role = 'admin'");
    expect(brand).toContain("scope = 'brand'");
    expect(brand).toContain('brand_id in (select public.user_brand_ids())');
    expect(workspace).toContain("scope = 'workspace'");
    for (const text of [own, brand, workspace]) {
      expect(text).toContain('deleted_at is null');
      expect(text).toContain(
        'select p.organization_id from public.profiles p where p.id = auth.uid()',
      );
    }
  });

  it('starts on for the workspace and for each person', () => {
    expect(memorySql).toMatch(
      /alter table public\.chat_settings\s+add column if not exists memory_enabled boolean not null default true/,
    );
    expect(memorySql).toMatch(
      /alter table public\.chat_user_prefs\s+add column if not exists memory_enabled boolean not null default true/,
    );
  });
});

const WAVE_4 = ['00462', '00463', '00464', '00465', '00466', '00467'];
const wave4 = WAVE_4.map(migration).join('\n');

/** The tables Wave 4 creates. */
const created4 = [...wave4.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);

/** A Wave 4 table's create statement, from its name to its closing parenthesis. */
function table4(name: string): string {
  const m = wave4.match(
    new RegExp(`create table if not exists public\\.${name} \\(([\\s\\S]*?)\\n\\);`),
  );
  if (!m) throw new Error(`No table ${name}`);
  return m[1];
}

/** A named constraint's check, from `add constraint {name}` to its statement's end. */
function constraint(text: string, name: string): string {
  const m = text.match(new RegExp(`add constraint ${name}\\s+check \\(([\\s\\S]*?)\\);`));
  if (!m) throw new Error(`No constraint ${name}`);
  return m[1].replace(/\s+/g, ' ').trim();
}

describe('Wave 4 tables', () => {
  it('creates the tables the plan lists', () => {
    expect(created4.sort()).toEqual(['chat_whats_new_reads', 'chat_outbound_emails'].sort());
  });

  it('lets members read at most, and anon nothing: every write is the server’s', () => {
    expect(wave4).not.toMatch(/grant (insert|update|delete|all)[^;]*to authenticated/);
    expect(wave4).not.toMatch(/create policy[^;]*for (insert|update|delete|all)\b/);
    expect(wave4).not.toMatch(/grant [^;]*to anon/);
    for (const name of created4) {
      expect(wave4, name).toMatch(
        new RegExp(`alter table public\\.${name} enable row level security`),
      );
      expect(wave4, name).toMatch(
        new RegExp(`revoke all on table public\\.${name} from anon, authenticated`),
      );
      expect(wave4, name).toMatch(
        new RegExp(`grant select on table public\\.${name} to authenticated`),
      );
      expect(wave4, name).toMatch(
        new RegExp(`grant all on table public\\.${name} to service_role`),
      );
    }
    const policies = [...wave4.matchAll(/create policy "[^"]+"[^;]*;/g)].map((m) =>
      m[0].replace(/\s+/g, ' '),
    );
    expect(policies).toHaveLength(2);
    for (const text of policies) expect(text).toContain('for select to authenticated using');
  });
});

describe('models and images (00462)', () => {
  const sql = migration('00462');

  it('keeps what a model takes and its context, still for the server only', () => {
    expect(sql).toMatch(/add column if not exists supported_parameters text\[\]/);
    expect(sql).toMatch(/add column if not exists context_length integer/);
    expect(sql).not.toMatch(/grant [^;]*on table public\.chat_model_prices/);
  });

  it('counts the images on an image row only', () => {
    expect(sql).toMatch(
      /alter table public\.prompt_improve_usage\s+add column if not exists units smallint/,
    );
    expect(constraint(sql, 'prompt_improve_usage_units_check')).toBe(
      "units is null or (units between 1 and 10 and feature = 'image')",
    );
  });
});

describe('a draft’s origin (00463)', () => {
  const sql = migration('00463');

  it('says where a draft was made, editor by default', () => {
    expect(sql).toMatch(/add column if not exists origin text not null default 'editor'/);
    expect(allowed(constraint(sql, 'content_drafts_origin_check'), 'origin')).toEqual([
      'editor',
      'chat',
      'action_center',
      'agent',
      'mcp',
    ]);
    expect(sql).toMatch(
      /conversation_id uuid\s+references public\.chat_conversations\(id\) on delete set null/,
    );
  });

  it('counts a draft with an action as the Action Center’s, without touching updated_at', () => {
    expect(sql).toMatch(
      /disable trigger content_drafts_updated_at;\s*update public\.content_drafts\s+set origin = 'action_center'\s+where action_id is not null/,
    );
    expect(sql).toMatch(/enable trigger content_drafts_updated_at;/);
  });

  it('lets a member say editor or chat, name only their own chat, and change neither', () => {
    const guard = body(sql, 'guard_content_draft_origin');
    expect(guard).toContain("new.origin not in ('editor', 'chat')");
    expect(guard).toContain('c.user_id = auth.uid()');
    expect(guard).toContain('new.origin is distinct from old.origin');
    expect(guard).toContain('rolbypassrls');
    expect(sql).toMatch(
      /before insert or update of origin, conversation_id on public\.content_drafts/,
    );
  });
});

describe('What’s new reads (00464)', () => {
  const reads = table4('chat_whats_new_reads');
  const sql = migration('00464');

  it('keeps one read per person and entry', () => {
    expect(reads).toMatch(/primary key \(user_id, entry_slug\)/);
    expect(reads).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/);
    expect(reads).toMatch(/entry_slug ~ '\^\[a-z0-9\]\+\(-\[a-z0-9\]\+\)\*\$'/);
  });

  it('shows a person only their own', () => {
    expect(policy('chat_whats_new_reads: own select', sql)).toContain(
      'using (user_id = auth.uid())',
    );
  });
});

describe('Library skills (00465)', () => {
  const sql = migration('00465');

  it('adds library as a source, pinned to its commit like an import', () => {
    expect(allowed(constraint(sql, 'chat_skills_source_check'), 'source')).toEqual([
      'user',
      'import',
      'library',
    ]);
    expect(constraint(sql, 'chat_skills_source_pin_check')).toBe(
      "source in ('import', 'library') or (source_url is null and commit_sha is null)",
    );
    expect(constraint(sql, 'chat_skills_library_check')).toBe(
      "((source = 'library') = (library_ref is not null)) and (source <> 'library' or commit_sha is not null)",
    );
  });

  it('drops 00458’s unnamed pin rule by what it says', () => {
    expect(sql).toContain("like '%''import''::text%'");
    expect(sql).toContain("like '%source_url IS NULL%'");
  });

  it('adds a catalog row once per workspace, and keeps when its source was checked', () => {
    expect(sql).toMatch(
      /create unique index if not exists chat_skills_library_ref_uidx\s+on public\.chat_skills \(organization_id, library_ref\)\s+where library_ref is not null/,
    );
    expect(sql).toMatch(/add column if not exists update_checked_at timestamptz/);
  });
});

describe('agents that call agents (00466)', () => {
  const sql = migration('00466');

  it('lets a version name up to 5 agents of its workspace, never itself', () => {
    expect(sql).toMatch(/add column if not exists can_call uuid\[\] not null default '\{\}'/);
    const check = constraint(sql, 'chat_agent_versions_can_call_check');
    expect(check).toContain('cardinality(can_call) <= 5');
    expect(check).toContain('not (agent_id = any (can_call))');
    expect(body(sql, 'chat_agent_versions_can_call_rules')).toContain(
      'caller.organization_id = callee.organization_id',
    );
  });

  it('starts a run from another agent’s run, one level deep, 3 calls a run at most', () => {
    expect(allowed(constraint(sql, 'chat_agent_runs_trigger_kind_check'), 'trigger_kind')).toEqual([
      'schedule',
      'signal',
      'kpi',
      'watch_rule',
      'manual',
      'action',
      'agent',
    ]);
    expect(constraint(sql, 'chat_agent_runs_called_by_check')).toBe(
      "(trigger_kind = 'agent') = (called_by_run_id is not null)",
    );
    const rules = body(sql, 'chat_agent_runs_call_rules');
    expect(rules).toContain('c.called_by_run_id is null');
    expect(rules).toContain('c.agent_id is distinct from new.agent_id');
    expect(rules).toContain('pg_advisory_xact_lock');
    expect(rules).toMatch(/\) >= 3 then/);
    expect(sql).toMatch(/before insert or update of called_by_run_id on public\.chat_agent_runs/);
  });
});

describe('outside e-mails (00467)', () => {
  const emails = table4('chat_outbound_emails');
  const sql = migration('00467');

  it('keeps up to 5 outside addresses on a job', () => {
    expect(sql).toMatch(
      /alter table public\.chat_schedules\s+add column if not exists external_recipients text\[\] not null default '\{\}'/,
    );
    expect(sql).toMatch(/cardinality\(external_recipients\) <= 5/);
  });

  it('prepares an e-mail that waits for a click, and expires in 7 days', () => {
    expect(allowed(emails, 'status')).toEqual(['pending', 'sent', 'cancelled', 'expired']);
    expect(emails).toMatch(/status text not null default 'pending'/);
    expect(emails).toMatch(
      /expires_at timestamptz not null default \(now\(\) \+ interval '7 days'\)/,
    );
    expect(emails).toMatch(/check \(\(status = 'sent'\) = \(sent_at is not null\)\)/);
    expect(sql).toMatch(
      /chat_outbound_emails_run_address_uidx\s+on public\.chat_outbound_emails \(schedule_run_id, to_address\)/,
    );
  });

  it('is read as its job is', () => {
    expect(policy('chat_outbound_emails: schedule select', sql)).toContain(
      'using (schedule_id in (select s.id from public.chat_schedules s))',
    );
  });
});
