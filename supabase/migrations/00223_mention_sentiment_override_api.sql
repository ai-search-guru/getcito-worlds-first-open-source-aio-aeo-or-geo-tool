-- ============================================================================
-- 00223: "Sentiment is wrong" over the API and MCP (MS-13)
-- ============================================================================
-- override_mention_sentiment (00160) takes the person correcting from
-- auth.uid(), so it only works for a signed-in admin or manager. The API and
-- MCP tools authenticate with an API key and reach the database as the
-- service role, where auth.uid() is null.
--
-- Restated with p_user_id: the person the service role corrects for, the API
-- key's owner. It counts only for the service role; a signed-in caller is
-- always auth.uid(), whatever it passes. Either way the person must be an
-- admin or manager of the answer's organization, and the correction is logged
-- under their name, as from the dashboard.
--
-- The 3-argument function is dropped rather than overloaded: a call with
-- three arguments would match both, and the dashboard's call keeps working
-- through p_user_id's default.

drop function if exists public.override_mention_sentiment(uuid, text, text);

-- Returns jsonb { changed, previous, sentiment, override: { id, sentiment,
-- previous_sentiment, note, user_name, created_at } }. Raises:
--   42501  the person isn't an admin or manager of the answer's organization
--   P0002  no such answer
--   22023  not a sentiment, or an answer that doesn't name the brand
create or replace function public.override_mention_sentiment(
  p_result_id uuid,
  p_sentiment text,
  p_note      text default null,
  p_user_id   uuid default null
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
  -- Who corrects: the API key's owner for the service role, else the caller.
  v_person   uuid := case when auth.role() = 'service_role' then p_user_id else auth.uid() end;
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
  where p.id = v_person
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

revoke execute on function public.override_mention_sentiment(uuid, text, text, uuid)
  from public, anon;
grant execute on function public.override_mention_sentiment(uuid, text, text, uuid)
  to authenticated, service_role;
