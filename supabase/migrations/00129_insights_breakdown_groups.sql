-- Insights breakdown panel: aggregate in Postgres instead of fetching rows.
--
-- The "View breakdown" panel (Visibility and Mentions) selected the raw
-- prompt_results rows of both comparison windows and grouped them in JS.
-- PostgREST caps an un-paginated select at 1,000 rows, in no fixed order, so
-- on any brand with more answers than that the panel scored an arbitrary
-- sample: 24.1 pts in the panel against 17.4 on the Visibility card for the
-- same 30 days (VIS-001).
--
-- This returns the panel's inputs already grouped, one entry per
-- (prompt, platform) — a few thousand at most, inside one jsonb value, so no
-- row cap applies. The components are the ones the Visibility score is built
-- from (frontend/src/lib/visibilityScore.ts), counted exactly as
-- refresh_insights_daily counts them for the rollups the card reads.
--
-- The window is either whole UTC days (p_day_from/p_day_to, the rollups' own
-- day boundaries, so the panel and the card cover the same answers) or a
-- timestamp range for the 24h and topic-filtered views, which the card also
-- answers from the raw rows. The prompts behind the groups come back
-- alongside with their text and topic, so the caller needs no second read.
--
-- SECURITY INVOKER like ai_visibility_aggregates (00040): RLS on
-- prompt_results, prompts and topics scopes everything to the caller's org.
-- chatgpt-shopping stays excluded (#155).
create or replace function public.insights_breakdown_groups(
  p_brand_id uuid,
  p_models text[] default null,
  p_region text default null,
  p_topic_id uuid default null,
  p_day_from date default null,
  p_day_to date default null,
  p_date_from timestamptz default null,
  p_date_to timestamptz default null
)
returns jsonb
language sql
stable
security invoker
set search_path to 'public'
as $$
  with groups as (
    select
      pr.prompt_id,
      pr.platform,
      count(*)                                                    as answers,
      count(*) filter (where pr.mention_count > 0)                as mention_answers,
      count(*) filter (where pr.citation_count > 0)               as citation_answers,
      sum(1.0 / pr.mention_position)
        filter (where pr.mention_position is not null)            as sum_inv_position,
      count(*) filter (where pr.mention_position is not null)     as position_count,
      coalesce(sum(pr.mention_count), 0)                          as mentions
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.platform <> 'chatgpt-shopping'
      and (p_models is null or pr.model_used = any (p_models))
      and (p_region is null or pr.region = p_region)
      and (p_day_from is null or pr.created_at >= (p_day_from::timestamp at time zone 'utc'))
      and (p_day_to is null or pr.created_at < ((p_day_to + 1)::timestamp at time zone 'utc'))
      and (p_date_from is null or pr.created_at >= p_date_from)
      and (p_date_to is null or pr.created_at <= p_date_to)
      and (p_topic_id is null or exists (
             select 1 from public.prompts p
             where p.id = pr.prompt_id and p.topic_id = p_topic_id))
    group by pr.prompt_id, pr.platform
  )
  select jsonb_build_object(
    'groups', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'prompt_id',        g.prompt_id,
                'platform',         g.platform,
                'answers',          g.answers,
                'mention_answers',  g.mention_answers,
                'citation_answers', g.citation_answers,
                'sum_inv_position', g.sum_inv_position,
                'position_count',   g.position_count,
                'mentions',         g.mentions))
       from groups g),
      '[]'::jsonb),
    'prompts', coalesce(
      (select jsonb_agg(jsonb_build_object(
                'id',         p.id,
                'text',       p.text,
                'topic_id',   p.topic_id,
                'topic_name', t.name))
       from public.prompts p
       left join public.topics t on t.id = p.topic_id
       where p.id in (select distinct g.prompt_id from groups g)),
      '[]'::jsonb)
  );
$$;

revoke all on function public.insights_breakdown_groups(
  uuid, text[], text, uuid, date, date, timestamptz, timestamptz
) from public;
grant execute on function public.insights_breakdown_groups(
  uuid, text[], text, uuid, date, date, timestamptz, timestamptz
) to authenticated, service_role;

comment on function public.insights_breakdown_groups(
  uuid, text[], text, uuid, date, date, timestamptz, timestamptz
) is
  'Insights breakdown panel inputs (VIS-001, 00129): Visibility-score components and mention totals per (prompt, platform) for one window, plus the prompts behind them. Whole UTC days or a timestamp range. Security invoker.';
