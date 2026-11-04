-- ============================================================================
-- 00232: the Prompts table's visibility and positions from an index alone
-- ============================================================================
-- On production the Prompts page's read failed after a tab switch
-- (2026-10-21, React #441 with a request at the 8.6 s authenticated
-- timeout), and the page showed "No prompts yet" (#1324 makes it say the
-- read failed). Its two window reads over the brand's answers both go to
-- the heap for every answer:
--
--   * prompt_visibility_summaries (00072) sums visibility_score,
--     mention_count, citation_count and mention_position;
--   * prompt_position_summaries_json (00153) sums mention_count,
--     mention_position and mentioned_entity_count, for the window and the
--     one before it.
--
-- idx_prompt_results_brand_created_cover (citations_domains) carries the
-- columns those reads filter on but not the ones they add up, and a
-- prompt_results row carries the whole answer text, so each answer is its
-- own page read (8–25 s cold for a 30-day window there).
--
--   1. idx_prompt_results_brand_created_metrics: the same key, the cover
--      index's columns and those figures, so both reads (and every read the
--      cover index serves) come from the index alone. Build it on production
--      with CREATE INDEX CONCURRENTLY before this runs; `if not exists` makes
--      it a no-op there. The cover index then serves nothing this one
--      doesn't: drop it (DROP INDEX CONCURRENTLY) once the plans show this
--      one in use.
--   2. prompt_visibility_summaries, the same rows: plpgsql planned for each
--      call's window (plan_cache_mode), security definer with the
--      organization check made explicit (the brand's rows only, instead of
--      prompt_results' row policy per answer), as the content reads (00226)
--      and prompt_position_summaries_json (00153) are. A caller outside the
--      brand's organization gets no rows, as row security gave before.

create index if not exists idx_prompt_results_brand_created_metrics
  on public.prompt_results (brand_id, created_at desc)
  include (id, platform, model_used, region, prompt_id,
           visibility_score, mention_count, citation_count,
           mention_position, mentioned_entity_count);

-- Dropped first: a database that ran another body with other columns can't
-- take the new one through create or replace.
drop function if exists public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text);

create function public.prompt_visibility_summaries(
  p_brand_id  uuid,
  p_date_from timestamptz default null,
  p_date_to   timestamptz default null,
  p_region    text default null
)
returns table (
  prompt_id              uuid,
  avg_visibility         double precision,
  avg_visibility_visible double precision,
  total_mentions         bigint,
  total_citations        bigint,
  runs                   bigint,
  visible_runs           bigint,
  mention_answers        bigint,
  citation_answers       bigint,
  position_factor        double precision,
  last_run_at            timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return;
  end if;

  return query
  select pr.prompt_id,
         avg(coalesce(pr.visibility_score, 0))::double precision,
         (avg(coalesce(pr.visibility_score, 0))
            filter (where pr.mention_count > 0 or pr.citation_count > 0))::double precision,
         coalesce(sum(pr.mention_count), 0)::bigint,
         coalesce(sum(pr.citation_count), 0)::bigint,
         count(*)::bigint,
         count(*) filter (where pr.mention_count > 0 or pr.citation_count > 0)::bigint,
         count(*) filter (where pr.mention_count > 0)::bigint,
         count(*) filter (where pr.citation_count > 0)::bigint,
         (avg(1.0 / pr.mention_position)
            filter (where pr.mention_position is not null))::double precision,
         max(pr.created_at)
  from public.prompt_results pr
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'  -- #155 - isolate from analytics
    and (p_date_from is null or pr.created_at >= p_date_from)
    and (p_date_to   is null or pr.created_at <= p_date_to)
    and (p_region    is null or pr.region = p_region)
  group by pr.prompt_id;
end;
$$;

revoke execute on function public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text)
  to authenticated, service_role;

comment on function public.prompt_visibility_summaries(uuid, timestamptz, timestamptz, text) is
  'Per-prompt visibility/mention aggregates for the All Prompts table. p_region scopes to one tracked location (#691); NULL blends every location. Planned with its arguments and read from idx_prompt_results_brand_created_metrics (00232); security definer, no rows when the caller is not a member of the brand''s organization.';
