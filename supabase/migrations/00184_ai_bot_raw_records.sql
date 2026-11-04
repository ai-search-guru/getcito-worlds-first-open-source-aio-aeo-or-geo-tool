-- ============================================================================
-- 00184: the raw-record cap for log senders (AT-010, part B)
-- ============================================================================
-- Spec §6.1 and §6.3: a Vercel drain sends every request log and the server
-- filters them, so it needs its own cap on what it receives (Growth 20M raw
-- records a month, Enterprise 200M). A Cloudflare Logpush job is filtered to
-- AI bots at the edge, but a job set up without the filter would send every
-- line, so the same cap guards it.
--
-- ai_bot_usage gains the month's raw records and when that cap was reached;
-- ai_bot_ingested_files keeps a retried file from being read twice.
-- ai_bot_count_raw adds a batch's records under the usage row's lock and
-- says whether the batch may be read: yes while the month was under the cap
-- when it arrived, so a month overshoots by at most the batch that crosses
-- it (a drain sends at most 1 MB). After that, batches are only counted.

alter table public.ai_bot_usage
  add column raw_records bigint not null default 0,
  add column raw_capped_at timestamptz;

-- A log file a sender sends again (it timed out waiting, say) is read once:
-- each connection's files by the SHA-256 of their body, claimed before the
-- read and given back when it fails, kept 7 days (the daily prune). No
-- policies: only the service role reads or writes.
create table public.ai_bot_ingested_files (
    connection_id uuid not null references public.ai_bot_connections(id) on delete cascade,
    body_hash text not null,
    received_at timestamptz not null default now(),
    primary key (connection_id, body_hash)
);

create index ai_bot_ingested_files_time_idx on public.ai_bot_ingested_files (received_at);

alter table public.ai_bot_ingested_files enable row level security;

create or replace function public.ai_bot_count_raw(
  p_connection_id uuid,
  p_count bigint,
  p_cap bigint
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_org uuid;
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_raw bigint;
  v_allowed boolean;
begin
  select b.organization_id into v_org
  from public.ai_bot_connections c
  join public.brands b on b.id = c.brand_id
  where c.id = p_connection_id and c.revoked_at is null;
  if v_org is null then
    return jsonb_build_object('error', 'connection');
  end if;

  insert into public.ai_bot_usage (organization_id, month)
  values (v_org, v_month)
  on conflict (organization_id, month) do nothing;

  select u.raw_records into v_raw
  from public.ai_bot_usage u
  where u.organization_id = v_org and u.month = v_month
  for update;

  v_allowed := p_cap < 0 or v_raw < p_cap;

  update public.ai_bot_usage u
  set raw_records = u.raw_records + greatest(p_count, 0),
      raw_capped_at = case
        when p_cap >= 0 and u.raw_capped_at is null and u.raw_records + greatest(p_count, 0) >= p_cap
          then now()
        else u.raw_capped_at
      end
  where u.organization_id = v_org and u.month = v_month;

  return jsonb_build_object(
    'allowed', v_allowed,
    'raw', v_raw + greatest(p_count, 0),
    'cap', p_cap
  );
end;
$$;

revoke all on function public.ai_bot_count_raw(uuid, bigint, bigint) from public, anon, authenticated;
grant execute on function public.ai_bot_count_raw(uuid, bigint, bigint) to service_role;

comment on function public.ai_bot_count_raw(uuid, bigint, bigint) is
  'AI bots (AT-010, spec §6.3): adds a log sender''s batch to the organization''s raw records this month and says whether it may be read (the month was under p_cap when it arrived; <0 = no cap). Locks the usage row. Service role only.';

notify pgrst, 'reload schema';
