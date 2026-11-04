-- Replaces ae_citation_sources from 00091.
--
-- It normalised every citation's domain — `regexp_replace` on ≈240k rows for
-- the largest brand — before deduplicating. It ran in 2.4s alone and timed
-- out under load during the first end-to-end run. Deduplicating on URL ids
-- first and normalising the ≈50k distinct URLs once brings it to 1.6s on the
-- same brand, and the detector retries a transient timeout on top.

create or replace function public.ae_citation_sources(p_brand_id uuid, p_from timestamptz)
returns jsonb
language sql stable
as $$
  with owned as (
    select regexp_replace(lower(domain), '^www\.', '') as d
    from public.brand_domains where brand_id = p_brand_id
  ),
  r as materialized (
    select id, prompt_id, coalesce(mention_count, 0) > 0 as bm,
           coalesce(competitor_mentions @? '$[*] ? (@.mention_count > 0)', false) as cm
    from public.prompt_results
    where brand_id = p_brand_id and created_at >= p_from
  ),
  rd as materialized (
    select distinct prc.prompt_result_id as rid, prc.url_id
    from public.prompt_result_citations prc
    where prc.brand_id = p_brand_id and prc.created_at >= p_from
  ),
  url_domain as materialized (
    select ids.url_id, regexp_replace(lower(u.domain), '^www\.', '') as domain
    from (select distinct url_id from rd) ids
    join public.citation_urls u on u.id = ids.url_id
  ),
  dom as materialized (
    select distinct rd.rid, ud.domain
    from rd join url_domain ud on ud.url_id = rd.url_id
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select dom.domain,
      exists (select 1 from owned o where dom.domain = o.d or dom.domain like '%.' || o.d) as owned,
      count(*) as results,
      count(distinct r.prompt_id) as prompts,
      count(*) filter (where r.bm) as with_brand,
      count(*) filter (where r.cm and not r.bm) as competitor_only,
      count(*) filter (where not r.bm) as without_brand
    from dom join r on r.id = dom.rid
    group by dom.domain
    order by count(*) desc
    limit 300
  ) x
$$;

revoke all on function public.ae_citation_sources(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ae_citation_sources(uuid, timestamptz) to service_role;
