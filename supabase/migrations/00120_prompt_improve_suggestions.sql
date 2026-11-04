-- Positions panel → Improve tab (PROMPT-003): AI-generated, platform-specific
-- suggestions to improve one prompt's position.
--
-- One row per (prompt, range, location): the whole generated set for every
-- platform the prompt was tracked on in that window. Generating costs a model
-- call, so the panel reads this row first and only regenerates when the user
-- asks or when newer answers have arrived since it was built
-- (latest_result_at).
--
-- range_key is the panel's range as the user picked it: a preset ('24h', '7d',
-- '30d', '90d') or 'custom:<from>:<to>'. Presets slide with the clock; keying
-- on the preset rather than the resolved bounds is what lets "30d" be reused
-- across a day instead of missing the cache every minute.
--
-- Edits, removals and the user's own suggestions are not stored here: they
-- live in the panel until sent to Action Center (PROMPT-004).

create table if not exists public.prompt_improve_suggestions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  range_key text not null,
  -- '' = every location, matching the Prompts table's location filter.
  region text not null default '',

  -- Per platform: { platform, state, runs, mentionPosition, citationRank, inputs }.
  platform_states jsonb not null default '[]'::jsonb,
  -- [{ id, platform, state, title, body, sources: [{ type, ref }], confidence }].
  suggestions jsonb not null default '[]'::jsonb,

  -- Newest answer the set was built from. A newer answer in the window marks
  -- the set stale, so it is rebuilt on the next open.
  latest_result_at timestamptz,
  model text,
  generated_at timestamptz not null default now()
);

create unique index if not exists prompt_improve_suggestions_key_idx
  on public.prompt_improve_suggestions (prompt_id, range_key, region);

create index if not exists prompt_improve_suggestions_brand_idx
  on public.prompt_improve_suggestions (brand_id);

-- Service-role only, like action_candidates (00089): the server reads and
-- writes it after checking the caller's brand access. No policy on purpose.
alter table public.prompt_improve_suggestions enable row level security;

comment on table public.prompt_improve_suggestions is
  'Cached Improve-tab suggestions per (prompt, range, location). Rebuilt on Regenerate or when an answer newer than latest_result_at arrives.';

-- Monthly Improve budget: one row per model call with its real token cost,
-- summed per organization over the subscription period against
-- plan.limits.improveMonthlyBudgetUsd, 1% of the plan price (Starter 0,
-- Growth $2.49, Enterprise $4.99 or 1% of plan_overrides.contractMonthlyUsd).
-- Charging the real cost keeps the share fixed whichever model is
-- configured. Same posture as brief_usage (00015): reading a cached set
-- costs nothing. Self-hosted bypasses the budget.

create table if not exists public.prompt_improve_usage (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prompt_id uuid references public.prompts(id) on delete set null,
  model text,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(12, 6) not null default 0,
  used_at timestamptz not null default now()
);

create index if not exists prompt_improve_usage_org_used_idx
  on public.prompt_improve_usage (organization_id, used_at);

-- Service-role only, no policy (as brief_usage).
alter table public.prompt_improve_usage enable row level security;
