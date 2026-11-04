-- Site Audit Opportunities (SA-004): prompts where a competitor is cited and
-- the brand isn't.
--
-- The Opportunities inbox lists, for each such prompt, the brand page closest
-- to it, as a page worth auditing. This read gives the prompts: per active
-- prompt of the brand, over the window, how many answers cited a competitor's
-- domain and how many cited one of the brand's own, and which competitor
-- domains were cited. Only prompts with a competitor citation are returned;
-- the caller keeps the ones the brand was never cited on.
--
-- Domains match as the citation tables store them (citation_urls.domain:
-- lowercase, no "www."), a domain or any of its subdomains. The caller passes
-- the brand's and its competitors' hosts the same way.
--
-- The window's cited URLs are matched once each, through their domain's
-- suffixes ("blog.example.com", "example.com", "com"), and only the
-- citations of matched URLs are joined to their answers. Matching every
-- citation against every domain with LIKE took 2.7 s warm and 13.5 s cold
-- for 30 days of the largest brand (796k citations, 118k distinct URLs);
-- this takes 1.4 s warm, with the same rows. plpgsql with force_custom_plan
-- so it is planned with the brand and window in hand.

create or replace function public.audit_competitor_cited_prompts(
  p_brand_id uuid,
  p_since timestamptz,
  p_own_domains text[],
  p_competitor_domains text[]
) returns table (
  prompt_id uuid,
  prompt_text text,
  results bigint,
  competitor_results bigint,
  own_results bigint,
  competitor_domains text[]
)
language plpgsql
stable
set search_path = public
set work_mem = '64MB'
set plan_cache_mode = 'force_custom_plan'
as $$
begin
  return query
  with sought as (
    select d as domain, true as own from unnest(p_own_domains) d
    union all
    select d, false from unnest(p_competitor_domains) d
  ),
  urls as (
    select distinct prc.url_id
    from prompt_result_citations prc
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
  ),
  -- Each cited URL on the brand's or a competitor's domain, or a subdomain.
  matched as (
    select u.url_id, s.domain, s.own
    from urls u
    join citation_urls cu on cu.id = u.url_id
    cross join lateral (
      select array_to_string((string_to_array(cu.domain, '.'))[i:], '.') as suffix
      from generate_series(1, cardinality(string_to_array(cu.domain, '.'))) i
    ) sx
    join sought s on s.domain = sx.suffix
  ),
  answers as (
    select pr.id, pr.prompt_id
    from prompt_results pr
    join prompts p on p.id = pr.prompt_id and p.is_active
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
  ),
  -- The answers' citations of matched URLs, with the domain each matched.
  hits as (
    select a.prompt_id, a.id, m.domain, m.own
    from prompt_result_citations prc
    join matched m on m.url_id = prc.url_id
    join answers a on a.id = prc.prompt_result_id
    where prc.brand_id = p_brand_id
      and prc.created_at >= p_since
  ),
  answer_counts as (
    select a.prompt_id, count(*) as results from answers a group by a.prompt_id
  ),
  per_prompt as (
    select h.prompt_id,
      count(distinct h.id) filter (where not h.own) as competitor_results,
      count(distinct h.id) filter (where h.own)     as own_results,
      array_agg(distinct h.domain order by h.domain) filter (where not h.own) as competitor_domains
    from hits h
    group by h.prompt_id
  )
  select pp.prompt_id, p.text, ac.results,
    pp.competitor_results, pp.own_results, pp.competitor_domains
  from per_prompt pp
  join answer_counts ac on ac.prompt_id = pp.prompt_id
  join prompts p on p.id = pp.prompt_id
  where pp.competitor_results > 0
  order by pp.competitor_results desc, pp.prompt_id;
end;
$$;

-- Service-role only, like the other server reads.
revoke all on function public.audit_competitor_cited_prompts(uuid, timestamptz, text[], text[])
  from public, anon, authenticated;
grant execute on function public.audit_competitor_cited_prompts(uuid, timestamptz, text[], text[])
  to service_role;

notify pgrst, 'reload schema';
