-- ============================================================================
-- 00410: Chat's tool results kept within a chat, and what each step and
-- model call measured
-- ============================================================================
-- The context engine (CHAT-04 items 9–10, 27–28; CHAT-20 §15a), behind
-- CHAT_AGENTIC: nothing writes here while the flag is off. Everything here
-- is the server's and staff's: tool names, results and costs never reach a
-- member (CHAT-03 item 22, CHAT-04 item 15).
--
--   * chat_tool_cache: within one chat, the same read with the same scope
--     reuses the earlier result (item 9), unless the data has refreshed
--     since: the engine compares data_as_of with the brand's newest
--     tracking run before it uses a row (§15a: the cache is dropped when
--     data_as_of moves). scope_hash is the sha-256 of the read's normalized
--     scope (brand, dates, platforms, filters, limit). Rows are kept a day
--     (expires_at, the sweep), and go with their chat. A reuse costs no
--     model tokens and no budget (item 27).
--   * chat_run_steps, a step's measure (staff only: members are granted
--     00400's columns, not these): latency_ms; cache_hit when its result
--     came from chat_tool_cache; truncated when the result was cut to the
--     run's budget before the model saw it (item 6); result_tokens, what it
--     sent the model.
--   * prompt_improve_usage, a model call's measure (the AI budget's ledger,
--     00405; server only): the prompt cache's read and write tokens (§D
--     item 28) and the call's latency. input_tokens and output_tokens are
--     already there (00120).

-- ─── A chat's tool results ──────────────────────────────────────────────────

create table if not exists public.chat_tool_cache (
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  -- The registry name of the tool that read.
  tool text not null check (char_length(tool) between 1 and 100),
  -- sha-256 (hex) of the read's normalized scope.
  scope_hash text not null check (scope_hash ~ '^[0-9a-f]{64}$'),
  -- The brand the read was about, whose refresh voids it; null for a
  -- workspace-wide read.
  brand_id uuid references public.brands(id) on delete cascade,
  -- The result as the model got it, already within the run's budget.
  result_json jsonb not null check (octet_length(result_json::text) <= 1000000),
  row_count integer check (row_count >= 0),
  data_as_of timestamptz,
  hits integer not null default 0 check (hits >= 0),
  created_at timestamptz not null default now(),
  last_hit_at timestamptz,
  expires_at timestamptz not null default (now() + interval '1 day'),
  primary key (conversation_id, tool, scope_hash)
);

create index if not exists chat_tool_cache_brand_idx
  on public.chat_tool_cache (brand_id) where brand_id is not null;
-- The sweep of expired results.
create index if not exists chat_tool_cache_expires_idx
  on public.chat_tool_cache (expires_at);

comment on table public.chat_tool_cache is
  'Chat (00410): within one chat, a read''s result by tool and normalized scope (CHAT-04 item 9), reused until the brand''s data refreshes (data_as_of) or it expires (a day). Server only.';

alter table public.chat_tool_cache enable row level security;
revoke all on table public.chat_tool_cache from anon, authenticated;
grant all on table public.chat_tool_cache to service_role;

-- ─── A step's measure ───────────────────────────────────────────────────────

alter table public.chat_run_steps
  add column if not exists latency_ms integer check (latency_ms >= 0),
  add column if not exists cache_hit boolean not null default false,
  add column if not exists truncated boolean not null default false,
  add column if not exists result_tokens integer check (result_tokens >= 0);

comment on column public.chat_run_steps.latency_ms is
  'How long the step took (CHAT-04 item 10). Staff only: never granted to members.';
comment on column public.chat_run_steps.cache_hit is
  'Its result came from chat_tool_cache (00410). Staff only.';
comment on column public.chat_run_steps.truncated is
  'Its result was cut to the run''s budget before the model saw it (CHAT-04 item 6). Staff only.';
comment on column public.chat_run_steps.result_tokens is
  'The tokens its result sent the model. Staff only.';

-- ─── A model call's measure ─────────────────────────────────────────────────

alter table public.prompt_improve_usage
  add column if not exists cache_read_tokens integer check (cache_read_tokens >= 0),
  add column if not exists cache_write_tokens integer check (cache_write_tokens >= 0),
  add column if not exists latency_ms integer check (latency_ms >= 0);

comment on column public.prompt_improve_usage.cache_read_tokens is
  'Input tokens the provider read from its prompt cache (CHAT-04 §D item 28). Null where not measured.';
comment on column public.prompt_improve_usage.cache_write_tokens is
  'Input tokens the provider wrote to its prompt cache. Null where not measured.';
comment on column public.prompt_improve_usage.latency_ms is
  'How long the model call took. Null where not measured.';

notify pgrst, 'reload schema';
