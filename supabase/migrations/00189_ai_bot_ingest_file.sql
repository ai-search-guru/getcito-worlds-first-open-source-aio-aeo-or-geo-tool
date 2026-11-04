-- ============================================================================
-- 00189: a bot log file read in one transaction, and bot rows pruned in batches
-- ============================================================================
-- Follow-ups from #1179's review (AT-010).
--
-- A Logpush file or a Vercel drain's delivery was read in steps, each its own
-- transaction: its claim (ai_bot_ingested_files), its raw records
-- (ai_bot_count_raw), then its verified events 500 at a time (ai_bot_ingest).
-- When a later step failed, the claim was given back, and the sender's retry
-- counted the raw records, and the chunks already written, a second time.
--
-- ai_bot_ingest_file takes all three steps in one transaction: a failure
-- leaves nothing behind, so the retry is read as new. A delivery of the same
-- file that arrives meanwhile waits on the claim's key, then reads as a
-- duplicate. A file holds at most 20,000 lines (botLogFormats.js), so its
-- events fit one call.
--
-- ai_bot_prune deletes at most p_limit rows past their retention from each
-- bot table per call. The daily run calls it until a call deletes fewer, so
-- no single DELETE runs into the statement timeout at Enterprise volume.

create or replace function public.ai_bot_ingest_file(
  p_connection_id uuid,
  p_body_hash text,
  p_records bigint,
  p_raw_cap bigint,
  p_cap bigint,
  p_events jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_claimed integer;
  v_raw jsonb;
  v_ingest jsonb;
begin
  insert into public.ai_bot_ingested_files (connection_id, body_hash)
  values (p_connection_id, p_body_hash)
  on conflict (connection_id, body_hash) do nothing;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('duplicate', true);
  end if;

  -- Raised rather than returned, so the claim rolls back with the rest.
  v_raw := public.ai_bot_count_raw(p_connection_id, p_records, p_raw_cap);
  if v_raw ? 'error' then
    raise exception 'ai_bot_count_raw: %', v_raw ->> 'error';
  end if;
  -- Past the month's raw cap the file is only counted.
  if not (v_raw ->> 'allowed')::boolean then
    return jsonb_build_object('raw_capped', true, 'raw', v_raw -> 'raw');
  end if;
  if coalesce(jsonb_array_length(p_events), 0) = 0 then
    return jsonb_build_object('received', 0, 'stored', 0, 'raw', v_raw -> 'raw');
  end if;

  v_ingest := public.ai_bot_ingest(p_connection_id, p_cap, p_events);
  if v_ingest ? 'error' then
    raise exception 'ai_bot_ingest: %', v_ingest ->> 'error';
  end if;
  return v_ingest || jsonb_build_object('raw', v_raw -> 'raw');
end;
$$;

revoke all on function public.ai_bot_ingest_file(uuid, text, bigint, bigint, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.ai_bot_ingest_file(uuid, text, bigint, bigint, bigint, jsonb)
  to service_role;

comment on function public.ai_bot_ingest_file(uuid, text, bigint, bigint, bigint, jsonb) is
  'AI bots (AT-010): one log file of a connection in one transaction: claims it by its body hash (a duplicate returns {duplicate}), adds its records to the month''s raw count (past p_raw_cap returns {raw_capped}), then writes its verified events as ai_bot_ingest does. A failure rolls the claim back too. Service role only.';

create or replace function public.ai_bot_prune(
  p_events_before timestamptz,
  p_daily_before date,
  p_files_before timestamptz,
  p_limit integer
)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_events integer;
  v_daily integer;
  v_files integer;
begin
  delete from public.ai_bot_events e
  where e.id in (
    select o.id from public.ai_bot_events o
    where o.occurred_at < p_events_before
    limit p_limit
  );
  get diagnostics v_events = row_count;

  delete from public.ai_bot_daily d
  using (
    select o.brand_id, o.day, o.bot, o.page from public.ai_bot_daily o
    where o.day < p_daily_before
    limit p_limit
  ) old
  where d.brand_id = old.brand_id and d.day = old.day and d.bot = old.bot and d.page = old.page;
  get diagnostics v_daily = row_count;

  delete from public.ai_bot_ingested_files f
  using (
    select o.connection_id, o.body_hash from public.ai_bot_ingested_files o
    where o.received_at < p_files_before
    limit p_limit
  ) old
  where f.connection_id = old.connection_id and f.body_hash = old.body_hash;
  get diagnostics v_files = row_count;

  return jsonb_build_object('events', v_events, 'daily', v_daily, 'files', v_files);
end;
$$;

revoke all on function public.ai_bot_prune(timestamptz, date, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.ai_bot_prune(timestamptz, date, timestamptz, integer)
  to service_role;

comment on function public.ai_bot_prune(timestamptz, date, timestamptz, integer) is
  'AI bots (AT-010): deletes at most p_limit rows from each of ai_bot_events (occurred_at), ai_bot_daily (day) and ai_bot_ingested_files (received_at) older than the given bounds, and returns how many it deleted from each. The daily run calls it until a call deletes fewer than p_limit. Service role only.';

notify pgrst, 'reload schema';
