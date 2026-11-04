-- ============================================================================
-- 00216: the AI answers that cite a draft's page, for its locked passages
-- ============================================================================
-- Locked passages (Content Editor spec v2 §8, CE-018): a passage of the page
-- AI answers quote today gets a green border and "Cited by ChatGPT 14× and
-- Perplexity 6× in 30 days · keep wording", and a person is warned before
-- changing it.
--
-- content_draft_cited_answers(draft, days) returns the answers of the last N
-- days (30 by default) whose citations name the page the draft optimizes,
-- the latest first: one {platform, response} each, at most 200, each
-- response cut to 12,000 characters. The editor finds the passages they
-- quote. ChatGPT Shopping cards are left out, as the Citations page does.
-- The page is content_drafts.source_url's path on that URL's host, which
-- must be one of the brand's domains, as in content_draft_sources (00211):
-- /pricing on another site of the brand's isn't it. The 200 answers are
-- picked first, and only their responses are read.
--
-- Security definer with an organization check through the draft's brand:
-- citation_urls has no member select policy. A draft without a page gets [];
-- one the caller can't read gets null.
create or replace function public.content_draft_cited_answers(
  p_draft_id uuid,
  p_days integer default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_brand_id uuid;
  v_page_key text;
  v_host text;
  v_since timestamptz;
  v_result jsonb;
begin
  select d.brand_id, lower(public.normalize_page_path(d.source_url)),
    -- Lower-cased first: a scheme may be written HTTPS://.
    regexp_replace(substring(lower(d.source_url) from '^https?://([^/:?#]+)'), '^www\.', '')
    into v_brand_id, v_page_key, v_host
  from public.content_drafts d
  where d.id = p_draft_id;

  if v_brand_id is null or (
    not exists (
      select 1 from public.brands b
      join public.profiles pf on pf.organization_id = b.organization_id
      where b.id = v_brand_id and pf.id = auth.uid()
    ) and auth.role() is distinct from 'service_role'
  ) then
    return null;
  end if;
  if p_days is null or p_days < 1 or p_days > 90 then
    raise exception 'content_draft_cited_answers: 1 to 90 days are needed' using errcode = '22023';
  end if;
  -- No page, or a page on a site that isn't the brand's: nothing cites it.
  if v_page_key is null or v_host is null or not exists (
    select 1 from public.brand_domains bd
    where bd.brand_id = v_brand_id
      and lower(regexp_replace(bd.domain, '^www\.', '')) = v_host
  ) then
    return '[]'::jsonb;
  end if;

  v_since := now() - make_interval(days => p_days);

  with
  -- Each answer once, however many of its citations name the page.
  citing as (
    select distinct prc.prompt_result_id
    from public.citation_urls cu
    join public.prompt_result_citations prc
      on prc.url_id = cu.id
     and prc.brand_id = v_brand_id
     and prc.created_at >= v_since
    where cu.domain = v_host
      and lower(public.normalize_page_path(cu.url)) = v_page_key
  ),
  -- The latest 200 first; only their responses are read.
  latest as (
    select pr.id, pr.created_at
    from citing c
    join public.prompt_results pr on pr.id = c.prompt_result_id
    where pr.platform is distinct from 'chatgpt-shopping'
      and pr.response <> ''
    order by pr.created_at desc
    limit 200
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object('platform', pr.platform, 'response', left(pr.response, 12000))
      order by l.created_at desc
    ),
    '[]'::jsonb
  )
    into v_result
  from latest l
  join public.prompt_results pr on pr.id = l.id;

  return v_result;
end;
$$;

revoke all on function public.content_draft_cited_answers(uuid, integer) from public, anon;
grant execute on function public.content_draft_cited_answers(uuid, integer)
  to authenticated, service_role;
