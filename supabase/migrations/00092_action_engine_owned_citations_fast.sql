-- Replaces ae_owned_citations from 00091, which took 6.1s on the largest
-- brand: it joined every citation of the last fortnight to its URL (≈480k
-- rows) and only then asked which were owned. This counts per URL id first,
-- straight off the (brand_id, created_at) covering index, and joins the few
-- thousand distinct URLs afterwards. 0.95s on the same brand — well clear of
-- the 8s statement timeout that took the nightly pass down twice (#829, #834).

create or replace function public.ae_owned_citations(
  p_brand_id uuid, p_cur_from timestamptz, p_prev_from timestamptz
) returns jsonb
language sql stable
as $$
  with owned as (
    select regexp_replace(lower(domain), '^www\.', '') as d
    from public.brand_domains where brand_id = p_brand_id
  ),
  per_url as materialized (
    select url_id,
      count(*) filter (where created_at >= p_cur_from) as cur_citations,
      count(*) filter (where created_at < p_cur_from) as prev_citations
    from public.prompt_result_citations
    where brand_id = p_brand_id and created_at >= p_prev_from
    group by url_id
  )
  select coalesce(jsonb_agg(row_to_json(x)), '[]'::jsonb) from (
    select u.url, p.cur_citations, p.prev_citations
    from per_url p
    join public.citation_urls u on u.id = p.url_id
    where exists (
      select 1 from owned o
      where regexp_replace(lower(u.domain), '^www\.', '') = o.d
         or regexp_replace(lower(u.domain), '^www\.', '') like '%.' || o.d
    )
    order by p.cur_citations + p.prev_citations desc
    limit 300
  ) x
$$;

revoke all on function public.ae_owned_citations(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.ae_owned_citations(uuid, timestamptz, timestamptz) to service_role;
