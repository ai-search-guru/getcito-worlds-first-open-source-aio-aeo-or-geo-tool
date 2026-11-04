-- ============================================================================
-- 00420: Why did it move — the analyses Chat ran, and when a person last
-- left Chat Home
-- ============================================================================
-- Why did it move (CHAT-22 feature 1) and Home's "Since you left" strip
-- (DESIGN-POLISH Home), behind CHAT_AGENTIC: nothing writes here while the
-- flag is off.
--
--   * chat_why_analyses: one row per explain_change a run made (CHAT-22 §1
--     items 5–6): the metric, the scope (engines, filters, prompt set, in
--     names), the two periods compared (a before b) and the result, the
--     explain_change contract (headline values, noise verdict, change point,
--     mix effect, ranked causes with evidence refs, excluded cells,
--     unexplained), all computed by the server from scheduled tracking data
--     with no model call (Addendum 2 G); data_as_of is the newest tracking
--     run it read. The model's short summary is the answer's text, not this
--     row's. Kept so the Why screen, its evidence drawer and a reload show
--     the same numbers. Engine weather and its benchmark panel are not here:
--     the plan hides them in Wave 2. Readable where its chat is (00400 and
--     00407); the server writes.
--   * chat_user_prefs.home_seen_at: when the person last left Chat Home,
--     what "Since you left" counts the changes after. Theirs to write, like
--     the rest of their settings row (00400).

create table if not exists public.chat_why_analyses (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.chat_conversations(id) on delete cascade,
  -- The run whose step made it. A deleted run leaves the analysis with its chat.
  run_id uuid references public.chat_runs(id) on delete set null,
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- CHAT-22 §1 item 2's v1 metrics.
  metric text not null check (
    metric in ('visibility', 'mention_rate', 'share_of_voice', 'citations', 'avg_position')
  ),
  -- Engines, filters and the prompt set, in names (CHAT-03: never ids).
  scope_json jsonb not null default '{}'::jsonb check (
    jsonb_typeof(scope_json) = 'object' and octet_length(scope_json::text) <= 8000
  ),
  -- Period a, then period b after it (by default the previous 7 days, then the last 7).
  period_a_start date not null,
  period_a_end date not null,
  period_b_start date not null,
  period_b_end date not null,
  -- The explain_change contract (CHAT-22 §1 item 6). Up to 1 MB as text.
  result_json jsonb not null check (
    jsonb_typeof(result_json) = 'object' and octet_length(result_json::text) <= 1000000
  ),
  data_as_of timestamptz,
  created_at timestamptz not null default now(),
  check (
    period_a_start <= period_a_end
    and period_a_end < period_b_start
    and period_b_start <= period_b_end
  )
);

create index if not exists chat_why_analyses_conversation_idx
  on public.chat_why_analyses (conversation_id, created_at desc);
create index if not exists chat_why_analyses_run_idx
  on public.chat_why_analyses (run_id) where run_id is not null;
create index if not exists chat_why_analyses_brand_idx
  on public.chat_why_analyses (brand_id, created_at desc);

comment on table public.chat_why_analyses is
  'Chat (00420): one Why did it move analysis (CHAT-22 §1): metric, scope, the two periods and the explain_change result, computed from scheduled tracking data with no model call. Readable where its chat is; the server writes.';
comment on column public.chat_why_analyses.result_json is
  'The explain_change contract: {metric, period_a, period_b, value_a, value_b, delta, se, noise_verdict, change_point, mix_effect, causes [{kind, share, contribution, confidence, cells, evidence_refs, fix_skill}], excluded_cells, unexplained}.';

-- ─── Since you left ─────────────────────────────────────────────────────────

alter table public.chat_user_prefs
  add column if not exists home_seen_at timestamptz;

comment on column public.chat_user_prefs.home_seen_at is
  'When the person last left Chat Home: "Since you left" counts what changed after it. Null: never.';

-- ─── Who reads and writes ───────────────────────────────────────────────────

alter table public.chat_why_analyses enable row level security;
revoke all on table public.chat_why_analyses from anon, authenticated;
grant select on table public.chat_why_analyses to authenticated;
grant all on table public.chat_why_analyses to service_role;

drop policy if exists "chat_why_analyses: chat select" on public.chat_why_analyses;
create policy "chat_why_analyses: chat select"
  on public.chat_why_analyses
  for select
  using (conversation_id in (select c.id from public.chat_conversations c));

notify pgrst, 'reload schema';
