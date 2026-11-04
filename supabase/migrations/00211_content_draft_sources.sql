-- ============================================================================
-- 00211: the sources a draft is built from, for the editor's Sources tab
-- ============================================================================
-- The Sources tab (Content Editor spec v2 §10, CE-008) names every source a
-- draft draws on, with where the draft uses it, and lets a person leave one
-- out or add their own.
--
-- content_draft_sources(draft, days) reads the brand's data over the last N
-- days (30 by default) and returns one jsonb:
--   * prompts: the draft's prompts (content_drafts.prompt_ids) and, for a
--     draft optimizing a live page, the prompts whose answers cited that
--     page; each with its answers in the window and those naming the brand;
--   * fanouts: the searches AI engines ran while answering those prompts
--     (prompt_results.search_queries, 00021), one row per normalized query
--     with its platforms and the answers that ran it, most searched first
--     (at most 30);
--   * citedPages: the pages those answers cited, with citations and answers
--     (at most 20); ChatGPT Shopping cards left out, as the Citations page
--     does;
--   * gscQueries: the brand's Search Console queries over 28 days with
--     clicks and impressions (at most 300). Search Console keeps no queries
--     per page, so the caller keeps the ones sharing words with the draft,
--     as pagePromptSuggestions.js does;
--   * brandDomains and competitorDomains, to name each cited page's kind.
-- Security definer with an organization check through the draft's brand:
-- citation_urls has no member select policy. The page a draft optimizes is
-- its source URL's path on that URL's host, which must be one of the brand's
-- domains: /pricing on another site of the brand's, or on a site not the
-- brand's, isn't it. Prompts are the brand's through their prompt set, as
-- everywhere else (a prompt needs no topic). Bounded by the brand and the
-- window on (brand_id, created_at), with citations grouped by address before
-- any address is read, and planned for each call's own values
-- (plan_cache_mode).
--
-- content_draft_sources (the table) keeps a person's choices: a source left
-- out (included false), and a page address or Search Console query added by
-- hand (added true). A prompt added by hand joins the draft's prompt_ids.

create table if not exists public.content_draft_sources (
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  kind text not null check (kind in ('prompt', 'fanout', 'cited_page', 'gsc_query')),
  ref text not null check (char_length(ref) between 1 and 2048),
  included boolean not null default true,
  added boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (draft_id, kind, ref),
  -- Only pages and queries are added by hand; a prompt joins prompt_ids.
  check (not added or kind in ('cited_page', 'gsc_query'))
);

alter table public.content_draft_sources enable row level security;

-- A draft the member can read is one in their organization (content_drafts'
-- own member policies), so the choices follow it.
create policy "content_draft_sources: member select"
  on public.content_draft_sources
  for select
  using (draft_id in (select d.id from public.content_drafts d));

create policy "content_draft_sources: member insert"
  on public.content_draft_sources
  for insert
  with check (draft_id in (select d.id from public.content_drafts d));

create policy "content_draft_sources: member update"
  on public.content_draft_sources
  for update
  using (draft_id in (select d.id from public.content_drafts d))
  with check (draft_id in (select d.id from public.content_drafts d));

create policy "content_draft_sources: member delete"
  on public.content_draft_sources
  for delete
  using (draft_id in (select d.id from public.content_drafts d));

grant select, insert, update, delete on public.content_draft_sources to authenticated;

create or replace trigger content_draft_sources_updated_at
  before update on public.content_draft_sources
  for each row execute function public.handle_updated_at();

comment on table public.content_draft_sources is
  'Content Editor (CE-008): a person''s choices on a draft''s sources — one left out (included false), or a page address or Search Console query added by hand (added true).';

create or replace function public.content_draft_sources(
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
  v_prompt_ids uuid[];
  v_page_key text;
  v_host text;
  v_since timestamptz;
  v_result jsonb;
begin
  select d.brand_id, d.prompt_ids, lower(public.normalize_page_path(d.source_url)),
    -- Lower-cased first: a scheme may be written HTTPS://.
    regexp_replace(substring(lower(d.source_url) from '^https?://([^/:?#]+)'), '^www\.', '')
    into v_brand_id, v_prompt_ids, v_page_key, v_host
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
    raise exception 'content_draft_sources: 1 to 90 days are needed' using errcode = '22023';
  end if;

  v_since := now() - make_interval(days => p_days);
  -- A page on a site that isn't the brand's is no page of the brand's.
  if v_host is null or not exists (
    select 1 from public.brand_domains bd
    where bd.brand_id = v_brand_id
      and lower(regexp_replace(bd.domain, '^www\.', '')) = v_host
  ) then
    v_page_key := null;
  end if;

  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = v_brand_id
  ),
  -- The page's addresses: its path on its host.
  page_urls as materialized (
    select cu.id
    from public.citation_urls cu
    where v_page_key is not null
      and cu.domain = v_host
      and lower(public.normalize_page_path(cu.url)) = v_page_key
  ),
  -- The window's answers, from idx_prompt_results_brand_created_cover alone:
  -- only for a draft with a page, to find the prompts citing it.
  window_answers as materialized (
    select pr.id, pr.prompt_id
    from public.prompt_results pr
    where v_page_key is not null
      and pr.brand_id = v_brand_id
      and pr.created_at >= v_since
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  -- The prompts whose answers cited the page the draft optimizes.
  page_prompts as (
    select distinct wa.prompt_id
    from public.prompt_result_citations prc
    join window_answers wa on wa.id = prc.prompt_result_id
    where prc.url_id in (select pu.id from page_urls pu)
      and prc.brand_id = v_brand_id
      and prc.created_at >= v_since
  ),
  source_prompts as (
    select p.id, p.text, p.id = any(v_prompt_ids) as in_draft,
      p.id in (select prompt_id from page_prompts) as cites_page
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = v_brand_id
      and (p.id = any(v_prompt_ids) or p.id in (select prompt_id from page_prompts))
  ),
  answers as materialized (
    select pr.id, pr.prompt_id, pr.platform, pr.mention_count, pr.search_queries
    from public.prompt_results pr
    where pr.brand_id = v_brand_id
      and pr.created_at >= v_since
      and pr.prompt_id in (select id from source_prompts)
      and pr.platform is distinct from 'chatgpt-shopping'
  ),
  prompt_counts as (
    select a.prompt_id, count(*) as answers, count(*) filter (where a.mention_count > 0) as mentioned
    from answers a
    group by a.prompt_id
  ),
  fanout_rows as (
    select
      a.id as answer_id,
      lower(trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g'))) as norm,
      trim(regexp_replace(q.item->>'query', '\s+', ' ', 'g')) as query,
      coalesce(nullif(q.item->>'source_platform', ''), a.platform) as platform
    from answers a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.search_queries) = 'array' then a.search_queries else '[]'::jsonb end
    ) as q(item)
    where coalesce(trim(q.item->>'query'), '') <> ''
  ),
  fanouts as (
    select min(query) as query, array_agg(distinct platform order by platform) as platforms,
      count(distinct answer_id) as searched
    from fanout_rows
    group by norm
    order by count(distinct answer_id) desc, min(query)
    limit 30
  ),
  -- Citations grouped by address first; only the top 20 addresses are read.
  cited_ids as (
    select prc.url_id, count(*) as citations, count(distinct a.id) as answers
    from answers a
    join public.prompt_result_citations prc
      on prc.prompt_result_id = a.id
     and prc.brand_id = v_brand_id
     and prc.created_at >= v_since
    group by prc.url_id
    order by count(*) desc, count(distinct a.id) desc, prc.url_id
    limit 20
  ),
  cited as (
    select cu.url, cu.title, cu.domain, ci.citations, ci.answers
    from cited_ids ci
    join public.citation_urls cu on cu.id = ci.url_id
  ),
  queries as (
    select g.query, sum(g.clicks)::bigint as clicks, sum(g.impressions)::bigint as impressions
    from public.gsc_query_stats g
    where g.brand_id = v_brand_id
      and g.date >= (now() at time zone 'utc')::date - 28
    group by g.query
    order by sum(g.clicks) desc, sum(g.impressions) desc, g.query
    limit 300
  )
  select jsonb_build_object(
    'prompts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', sp.id,
          'text', sp.text,
          'inDraft', sp.in_draft,
          'citesPage', sp.cites_page,
          'answers', coalesce(pc.answers, 0),
          'mentioned', coalesce(pc.mentioned, 0)
        ) order by sp.in_draft desc, sp.text)
      from source_prompts sp
      left join prompt_counts pc on pc.prompt_id = sp.id
    ), '[]'::jsonb),
    'fanouts', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', f.query, 'platforms', to_jsonb(f.platforms), 'searched', f.searched
        ) order by f.searched desc, f.query)
      from fanouts f
    ), '[]'::jsonb),
    'citedPages', coalesce((
      select jsonb_agg(jsonb_build_object(
          'url', c.url, 'title', c.title, 'domain', c.domain,
          'citations', c.citations, 'answers', c.answers
        ) order by c.citations desc, c.answers desc, c.url)
      from cited c
    ), '[]'::jsonb),
    'gscQueries', coalesce((
      select jsonb_agg(jsonb_build_object(
          'query', q.query, 'clicks', q.clicks, 'impressions', q.impressions
        ) order by q.clicks desc, q.impressions desc, q.query)
      from queries q
    ), '[]'::jsonb),
    'brandDomains', coalesce((select jsonb_agg(domain order by domain) from own_domains), '[]'::jsonb),
    'competitorDomains', coalesce((
      select jsonb_agg(distinct lower(regexp_replace(c.domain, '^www\.', '')))
      from public.competitors c
      where c.brand_id = v_brand_id and coalesce(c.domain, '') <> ''
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.content_draft_sources(uuid, integer) from public, anon;
grant execute on function public.content_draft_sources(uuid, integer) to authenticated, service_role;

comment on function public.content_draft_sources(uuid, integer) is
  'Content Editor (CE-008): a draft''s sources over the last N days — its prompts and those citing its page, their AI fan-out searches, the pages their answers cited, the brand''s Search Console queries, and the brand and competitor domains. Security definer with an organization check through the draft''s brand.';
