-- ============================================================================
-- 00160: "Sentiment is wrong" — correcting an answer's sentiment (MS-08)
-- ============================================================================
-- Tracking classifies each answer's tone toward the brand once, when it is
-- stored (prompt_results.sentiment, set only when the brand is named). A
-- person who knows better can now correct it from the Mentions tab's
-- response drawer. The spec asks that "a sentiment override changes the
-- metrics within one refresh and is logged":
--
--   * the answer's sentiment itself changes, so every figure that reads it
--     agrees: Insights' Net and Positive sentiment, the Mentions tab, the
--     Positions panel, reports written from now on, the MCP tools;
--   * its stored visibility_score follows, by the same sentiment bonus
--     tracking adds (backend/src/lib/responseParser.js
--     computeVisibilityScore: +15 positive, +7 neutral when named, 0
--     negative; its parts add up to at most 100, so swapping the bonus is
--     exact);
--   * the answer's UTC day is refreshed in the Insights (refresh_insights_daily)
--     and Mentions (refresh_mentions_daily) rollups, so the change shows at
--     once instead of after the nightly sweep;
--   * every correction is kept in sentiment_overrides, with the tone it
--     replaced, who made it, when, and an optional note: the history the page
--     shows, and what a future classifier can learn from.
--
-- Only admins and managers correct, as with editing prompts. Members of the
-- brand's organization read the history.

create table if not exists public.sentiment_overrides (
  id                  uuid primary key default gen_random_uuid(),
  result_id           uuid not null references public.prompt_results(id) on delete cascade,
  brand_id            uuid not null references public.brands(id) on delete cascade,
  previous_sentiment  text not null,
  sentiment           text not null check (sentiment in ('positive', 'neutral', 'negative')),
  note                text check (note is null or char_length(note) <= 500),
  user_id             uuid references public.profiles(id) on delete set null,
  -- Kept as written: profiles are readable only by their owner, and the
  -- history should still name a person who later leaves the organization.
  user_name           text,
  created_at          timestamptz not null default now()
);

create index if not exists idx_sentiment_overrides_result
  on public.sentiment_overrides (result_id, created_at desc);
create index if not exists idx_sentiment_overrides_brand
  on public.sentiment_overrides (brand_id, created_at desc);

alter table public.sentiment_overrides enable row level security;

create policy "sentiment_overrides: member select" on public.sentiment_overrides
  for select using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- Written only through override_mention_sentiment below, which checks the
-- role; the history is append-only.
create policy "sentiment_overrides: no client insert" on public.sentiment_overrides
  for insert with check (false);
create policy "sentiment_overrides: no client update" on public.sentiment_overrides
  for update using (false);
create policy "sentiment_overrides: no client delete" on public.sentiment_overrides
  for delete using (false);

-- Tracking's sentiment bonus in visibility_score, for an answer that names the brand.
create or replace function public.sentiment_visibility_bonus(p_sentiment text)
returns integer
language sql
immutable
set search_path to 'public'
as $$
  select case p_sentiment when 'positive' then 15 when 'neutral' then 7 else 0 end;
$$;

-- Returns jsonb { changed, previous, sentiment, override: { id, sentiment,
-- previous_sentiment, note, user_name, created_at } }. Raises:
--   42501  the caller isn't an admin or manager of the answer's organization
--   P0002  no such answer
--   22023  not a sentiment, or an answer that doesn't name the brand
create or replace function public.override_mention_sentiment(
  p_result_id uuid,
  p_sentiment text,
  p_note      text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row      record;
  v_user     record;
  v_day      date;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_override public.sentiment_overrides;
begin
  if p_sentiment is null or p_sentiment not in ('positive', 'neutral', 'negative') then
    raise exception 'Invalid sentiment' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'The note is longer than 500 characters' using errcode = '22023';
  end if;

  select pr.id, pr.brand_id, pr.sentiment, pr.mention_count, pr.created_at, b.organization_id
    into v_row
  from public.prompt_results pr
  join public.brands b on b.id = pr.brand_id
  where pr.id = p_result_id
  for update of pr;
  if not found then
    raise exception 'Answer not found' using errcode = 'P0002';
  end if;

  select p.id, p.full_name, p.role
    into v_user
  from public.profiles p
  where p.id = auth.uid()
    and p.organization_id = v_row.organization_id
    and p.role = any (array['admin', 'manager']::public.user_role[]);
  if not found then
    raise exception 'Only admins and managers can correct a sentiment' using errcode = '42501';
  end if;

  -- Sentiment is only classified for answers that name the brand.
  if coalesce(v_row.mention_count, 0) <= 0 then
    raise exception 'This answer does not name the brand' using errcode = '22023';
  end if;

  if v_row.sentiment = p_sentiment then
    return jsonb_build_object('changed', false, 'previous', v_row.sentiment,
                              'sentiment', p_sentiment, 'override', null);
  end if;

  update public.prompt_results
     set sentiment = p_sentiment,
         visibility_score = greatest(0, least(100,
           coalesce(visibility_score, 0)
           - public.sentiment_visibility_bonus(v_row.sentiment)
           + public.sentiment_visibility_bonus(p_sentiment)))
   where id = p_result_id;

  insert into public.sentiment_overrides
    (result_id, brand_id, previous_sentiment, sentiment, note, user_id, user_name)
  values
    (p_result_id, v_row.brand_id, coalesce(v_row.sentiment, 'neutral'), p_sentiment, v_note,
     v_user.id, v_user.full_name)
  returning * into v_override;

  -- The answer's day in the rollups, now rather than at the nightly sweep.
  v_day := (v_row.created_at at time zone 'utc')::date;
  perform public.refresh_insights_daily(v_row.brand_id, v_day, v_day);
  perform public.refresh_mentions_daily(v_row.brand_id, v_day, v_day);

  return jsonb_build_object(
    'changed', true,
    'previous', v_override.previous_sentiment,
    'sentiment', v_override.sentiment,
    'override', jsonb_build_object(
      'id', v_override.id,
      'sentiment', v_override.sentiment,
      'previous_sentiment', v_override.previous_sentiment,
      'note', v_override.note,
      'user_name', v_override.user_name,
      'created_at', v_override.created_at));
end;
$$;

revoke execute on function public.override_mention_sentiment(uuid, text, text) from public, anon;
grant execute on function public.override_mention_sentiment(uuid, text, text)
  to authenticated, service_role;
