-- ============================================================================
-- 00207: the overlap check before a page is written (Content Editor, CE-015)
-- ============================================================================
-- Start checks for overlap before anything is written (Content Editor spec v2
-- §5): which of the brand's own pages AI already cites for the prompts the
-- new page should answer, how many of those prompts each one answers, how
-- often it is cited, and where it ranks on Google. One page that already
-- answers most of them is better optimized than competed with.
--
--   * content_page_overlap(brand, prompt ids): the brand's pages cited in
--     tracked answers to those prompts since p_since (30 days by default),
--     one row per page (lower(normalize_page_path) key): prompts in common,
--     citations, and the impression-weighted Google position over the last
--     28 days of Search Console data, when there is some. Most prompts in
--     common first. Security definer with an organization check, as
--     ai_traffic_page_citations (00176): citation_urls has no member select
--     policy. Read through citation_urls' domain index first, as
--     ga_page_ai_visibility does. The window's answers to the prompts come
--     from idx_prompt_results_brand_created_cover alone (an index-only scan,
--     hash-joined), never from prompt_results' wide rows one citation at a
--     time; ChatGPT Shopping is left out, as in Impact (00209). Planned for
--     each call's own values (plan_cache_mode): a generic plan of these
--     estimates is far slower.
--   * content_drafts.source_url: the existing page a draft optimizes, when
--     there is one (Start's "Optimize … instead"); the editor shows it beside
--     the page type.

alter table public.content_drafts
  add column if not exists source_url text
    check (
      source_url is null
      or (char_length(source_url) <= 2048 and source_url ~* '^https?://')
    );

comment on column public.content_drafts.source_url is
  'Content Editor (CE-015): the existing page this draft optimizes.';

create or replace function public.content_page_overlap(
  p_brand_id uuid,
  p_prompt_ids uuid[],
  p_since timestamptz default now() - interval '30 days'
)
returns table (
  page text,
  title text,
  prompts_in_common integer,
  citations bigint,
  gsc_position numeric
)
language plpgsql
stable
security definer
set search_path to 'public'
set plan_cache_mode to 'force_custom_plan'
as $$
begin
  if not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) and auth.role() is distinct from 'service_role' then
    return;
  end if;
  if coalesce(cardinality(p_prompt_ids), 0) = 0 then
    return;
  end if;

  return query
  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as materialized (
    select cu.id, cu.url, cu.title, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  -- The window's answers to these prompts, from the (brand_id, created_at)
  -- cover index alone.
  answers as materialized (
    select pr.id, pr.prompt_id
    from public.prompt_results pr
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
      and pr.prompt_id = any(p_prompt_ids)
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  cited as (
    select ou.page_key, ou.url, ou.title, a.prompt_id
    from public.prompt_result_citations prc
    join answers a on a.id = prc.prompt_result_id
    join own_urls ou on ou.id = prc.url_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
  ),
  pages as (
    select
      c.page_key,
      -- The address cited most often stands for the page.
      mode() within group (order by c.url) as page,
      max(c.title) as title,
      count(distinct c.prompt_id)::integer as prompts_in_common,
      count(*)::bigint as citations
    from cited c
    group by c.page_key
  ),
  google as (
    select
      g.page_key,
      round((sum(g.position * g.impressions) / nullif(sum(g.impressions), 0))::numeric, 1)
        as position
    from public.gsc_page_stats g
    where g.brand_id = p_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
      and g.page_key in (select p.page_key from pages p)
    group by g.page_key
  )
  select p.page, p.title, p.prompts_in_common, p.citations, gl.position
  from pages p
  left join google gl on gl.page_key = p.page_key
  order by p.prompts_in_common desc, p.citations desc, p.page
  limit 10;
end;
$$;

revoke all on function public.content_page_overlap(uuid, uuid[], timestamptz) from public, anon;
grant execute on function public.content_page_overlap(uuid, uuid[], timestamptz)
  to authenticated, service_role;

comment on function public.content_page_overlap(uuid, uuid[], timestamptz) is
  'Content Editor (CE-015): the brand''s own pages cited for these prompts since p_since, with prompts in common, citations and Google position, for Start''s overlap check. Security definer with an organization check.';
