-- ============================================================================
-- 00194: which pages the weekly digest may name
-- ============================================================================
-- Follow-up from #1196's review (AT-013). The weekly AI Traffic e-mail names
-- the pages whose AI visits moved most, and the top broken AI link with its
-- suggested redirect. The snippet's beacon is public, so a page path in
-- ai_traffic_logs can be anything a caller sent (00186 also picks redirects
-- among the pages it logged), and the e-mail would print it.
--
-- ai_traffic_known_pages takes the page keys the digest would name (as the
-- Pages section keys them: lower(normalize_page_path), 00178) and returns
-- those a source the beacon can't write knows: the site's pages (site_pages,
-- 00104: up to 500 from the sitemap, Analytics and citations, nightly),
-- Google Analytics in the last 90 days, the pages tracked AI answers cited in
-- the last 90 days, and active prompts' target URLs — and the home page,
-- which every site has. The digest asks only about a handful of pages a
-- week. Service role only.

create or replace function public.ai_traffic_known_pages(
  p_brand_id uuid,
  p_pages text[]
)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  with asked as (
    select distinct p.page from unnest(p_pages) as p(page)
  ),
  known as (
    select '/' as page
    union
    select lower(public.normalize_page_path(sp.url))
    from public.site_pages sp
    where sp.brand_id = p_brand_id
    union
    select lower(public.normalize_page_path(g.landing_page))
    from public.ga_page_stats g
    where g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= current_date - 90
    union
    select lower(public.normalize_page_path(g.landing_page))
    from public.ga_ai_traffic_stats g
    where g.brand_id = p_brand_id
      and g.landing_page <> ''
      and g.date >= current_date - 90
    union
    select c.page_key
    from public.ai_traffic_page_citations(p_brand_id, current_date - 90, current_date) c
    union
    select lower(public.normalize_page_path(ptu.url))
    from public.prompt_target_urls ptu
    join public.prompts p on p.id = ptu.prompt_id and p.is_active
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
  )
  select coalesce(array_agg(a.page order by a.page), '{}')
  from asked a
  where a.page in (select k.page from known k);
$$;

revoke all on function public.ai_traffic_known_pages(uuid, text[])
  from public, anon, authenticated;
grant execute on function public.ai_traffic_known_pages(uuid, text[])
  to service_role;

comment on function public.ai_traffic_known_pages(uuid, text[]) is
  'AI Traffic weekly digest (AT-013): of the given page keys, those the site''s pages, Google Analytics (90 days), AI answer citations (90 days) or active prompts'' target URLs know, so the e-mail never prints a path only the public beacon sent. Service role only.';

notify pgrst, 'reload schema';
