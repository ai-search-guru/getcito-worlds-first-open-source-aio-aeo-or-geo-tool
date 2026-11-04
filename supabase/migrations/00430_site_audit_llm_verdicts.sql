-- ============================================================================
-- 00430: Site Audit's AI verdicts, kept so an unchanged page keeps its score
-- ============================================================================
-- The 13 AI-judged signals (backend/src/lib/audit/llmSignals.js) were judged
-- again on every audit, so an unchanged page's score moved 2–3 points. Each
-- verdict is kept here by what it was judged from: the hash of the input that
-- signal reads, the signal, the model and the prompt version. An audit whose
-- input is the same reads the verdict back with no AI call; a page that
-- changed is judged again only on the signals whose input changed.
--
--   * Rows are shared by every brand: a verdict depends on the hashed input
--     alone, never on who asked.
--   * reason: the verdict's one short sentence, as the report shows it.
--   * used_at: the last audit that read the row. The server's daily run
--     deletes rows no audit has read for 180 days
--     (site_audit_llm_verdicts_prune).
--
-- site_audits.partial: the AI-judged signals didn't run and the page had no
-- earlier verdicts to keep, so the score leaves them out. A partial audit is
-- kept out of the score comparisons (previous score, change, trend).
--
-- Server only: no policy lets a member read or write the verdicts.

create table if not exists public.site_audit_llm_verdicts (
  id uuid primary key default gen_random_uuid(),
  input_hash text not null check (char_length(input_hash) = 64),
  signal_key text not null check (char_length(signal_key) between 1 and 100),
  model text not null check (char_length(model) between 1 and 200),
  prompt_version text not null check (char_length(prompt_version) between 1 and 50),
  status text not null check (status in ('pass', 'warn', 'fail', 'na')),
  score numeric check (score is null or (score >= 0 and score <= 1)),
  reason text not null default '' check (char_length(reason) <= 500),
  created_at timestamptz not null default now(),
  used_at timestamptz not null default now(),
  unique (input_hash, signal_key, model, prompt_version)
);

-- The daily prune walks the least recently used first.
create index if not exists site_audit_llm_verdicts_used_idx
  on public.site_audit_llm_verdicts (used_at);

comment on table public.site_audit_llm_verdicts is
  'Site Audit AI verdicts by input hash, signal, model and prompt version (llmSignals.js): an unchanged input reads its verdict back with no AI call. Server only.';
comment on column public.site_audit_llm_verdicts.input_hash is
  'sha256 (hex) of the input the signal reads, as the prompt sends it.';
comment on column public.site_audit_llm_verdicts.used_at is
  'The last audit that read the row; rows unread for 180 days are pruned daily.';

alter table public.site_audit_llm_verdicts enable row level security;
revoke all on table public.site_audit_llm_verdicts from anon, authenticated;
grant all on table public.site_audit_llm_verdicts to service_role;

alter table public.site_audits
  add column if not exists partial boolean not null default false;

comment on column public.site_audits.partial is
  'The AI-judged signals did not run and none were kept from an earlier audit of the page: the score leaves them out and is not compared with other audits.';

-- Deletes at most p_limit verdicts no audit has read since p_before, least
-- recently used first; the server's daily run calls it until fewer come back.
create or replace function public.site_audit_llm_verdicts_prune(
  p_before timestamptz,
  p_limit integer
)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_deleted integer;
begin
  delete from public.site_audit_llm_verdicts v
  where v.id in (
    select o.id from public.site_audit_llm_verdicts o
    where o.used_at < p_before
    order by o.used_at
    limit p_limit
  );
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.site_audit_llm_verdicts_prune(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.site_audit_llm_verdicts_prune(timestamptz, integer)
  to service_role;

notify pgrst, 'reload schema';
