-- Why a valuable page gets nothing from AI engines (#719).
--
-- Detection (#724) answers "which pages carry weight and receive no AI
-- referral". It cannot answer why, and the three reasons need different
-- actions:
--
--   cited              answers do cite this page, and it still earns no
--                      visit — a click-through problem, not a coverage one
--   targeted_not_cited a prompt we track points at this page and no answer
--                      cites it — a genuine visibility loss
--   not_targeted       nothing we track points here at all — a coverage gap,
--                      and the most common finding on a large site
--
-- Measured before building, on the only property connected today: of 16 open
-- findings, 5 are cited — one of them 104 times in 28 days. The surface calls
-- all 16 "pages AI engines aren't sending traffic to", which is true and, for
-- those 5, points at the wrong fix.
--
-- Two things this migration also repairs. Detection read 28 days of
-- ga_page_stats with an un-paginated select, and PostgREST caps that at 1000
-- rows (the #427/#450/#464 trap). ga-sync keeps up to PAGE_DAILY_LIMIT = 5000
-- pages per day, so a property with more than ~36 pages taking traffic on an
-- average day overflows it. Today's single property produces 743 rows and
-- fits, which is why nothing has gone wrong yet. The failure is worse than
-- missing findings: the AI-traffic read truncates the same way, so a page
-- that did receive AI traffic can fall out of the lookup and be raised as a
-- finding that is simply false. Aggregating here collapses page × day into
-- one row per page, and the caller pages through what is left.

-- ─── Percent-decoding that cannot take the run down ─────────────────────────
--
-- 12.7% of the cited URLs on brands' own domains are percent-encoded (2,647
-- of 20,896) — non-ASCII paths, which is most of this customer base. Matching
-- them against GA's decoded paths without decoding would classify a page that
-- IS cited as one nothing points to, which is the exact error this migration
-- exists to remove.
--
-- The decode has to be total, not correct-on-good-input: real citation URLs
-- in the database contain sequences that decode to invalid UTF-8 (0x80 was
-- found by running this over them). convert_from raises on those, and an
-- exception inside the aggregate would abort detection for the whole brand,
-- so a URL that cannot be decoded is returned as it came instead.
create or replace function public.url_decode_safe(p_value text)
returns text
language plpgsql
immutable
parallel safe
set search_path to 'public'
as $$
begin
  -- Nothing to do for the overwhelming majority, and this keeps the
  -- per-character regexp off every path that has no escape in it.
  if p_value is null or p_value not like '%\%%' then
    return p_value;
  end if;

  return (
    select convert_from(
      cast(
        e'\\x' || string_agg(
          case
            when length(m[1]) = 1 then encode(convert_to(m[1], 'UTF8'), 'hex')
            else substring(m[1] from 2 for 2)
          end,
          ''
        ) as bytea
      ),
      'UTF8'
    )
    from regexp_matches(p_value, '%[0-9a-fA-F][0-9a-fA-F]|.', 'g') as m
  );
exception
  when others then
    return p_value;
end;
$$;

comment on function public.url_decode_safe(text) is
  'Percent-decode a URL, returning the input unchanged when it cannot be decoded (#719). Total by design: real citation URLs contain sequences that are not valid UTF-8.';

-- ─── One spelling of "the same page" ────────────────────────────────────────
--
-- Four sources have to agree on it: GA landing pages (a path), citation URLs
-- (absolute, from the provider), prompt target URLs (typed by a person, so
-- anything), and the findings already stored. Scheme and host go, the query
-- string and fragment go, and a trailing slash goes.
--
-- Case is matched on but never rewritten, and the difference is not academic.
-- Folding the path to lower case turned a real slug — /blog/YmVzdC10b2 — into
-- /blog/ymvzdc10b2, a URL that does not exist on the site. The finding would
-- have carried it into the surface, where a customer clicking the page they
-- were told to fix would get a 404. The RPC below therefore groups on the
-- lowercased path and reports the spelling Analytics actually observed:
-- /Pricing and /pricing stay one page, and the one shown is a page that
-- resolves.
--
-- Decoding happens after the query string is cut, not before: an encoded %3F
-- inside a path is part of the path, and decoding first would let it split
-- the URL somewhere it does not split.
create or replace function public.normalize_page_path(p_url text)
returns text
language sql
immutable
parallel safe
set search_path to 'public'
as $$
  select coalesce(
    nullif(
      rtrim(
        public.url_decode_safe(
          split_part(
            split_part(
              regexp_replace(coalesce(p_url, ''), '^[a-zA-Z][a-zA-Z0-9+.-]*://[^/]*', ''),
              '?', 1
            ),
            '#', 1
          )
        ),
        '/'
      ),
      ''
    ),
    '/'
  );
$$;

comment on function public.normalize_page_path(text) is
  'A URL or path reduced to the page it names (#719): host, query, fragment and trailing slash removed, percent escapes decoded where possible. Case is preserved — callers lower() it to match, and keep this value to display.';

-- ─── One row per page, with everything the engine needs to judge it ─────────
--
-- The citation half is written to be read through citation_urls first. The
-- obvious direction — walk the brand's citations and keep the ones on its own
-- domain — scans every citation the brand has (609,496 rows in 28 days for
-- the property measured, 2.17s). Starting from the domain index and looking
-- the citations up by url_id turns that into 445 index probes and 59ms, for
-- the same 45 pages.
create or replace function public.ga_page_ai_visibility(p_brand_id uuid, p_since date)
returns table (
  landing_page text,
  sessions bigint,
  engaged_sessions bigint,
  key_events bigint,
  transactions bigint,
  revenue double precision,
  engagement_seconds bigint,
  ai_sessions bigint,
  ai_platforms text[],
  citations bigint,
  citing_prompts bigint,
  targeting_prompts bigint
)
language sql
stable
security invoker
set search_path to 'public'
as $$
  with own_domains as (
    select lower(regexp_replace(bd.domain, '^www\.', '')) as domain
    from public.brand_domains bd
    where bd.brand_id = p_brand_id
  ),
  own_urls as (
    -- citation_urls.domain is already stored lowercased and without www, so
    -- this is an index probe rather than a scan.
    select cu.id, lower(public.normalize_page_path(cu.url)) as page_key
    from public.citation_urls cu
    where cu.domain in (select domain from own_domains)
  ),
  cited as (
    select
      ou.page_key,
      count(*)::bigint as citations,
      count(distinct pr.prompt_id)::bigint as citing_prompts
    from own_urls ou
    join public.prompt_result_citations prc
      on prc.url_id = ou.id
     and prc.brand_id = p_brand_id
     and prc.created_at >= p_since
    join public.prompt_results pr on pr.id = prc.prompt_result_id
    group by ou.page_key
  ),
  targeted as (
    -- Explicit targeting only. "A prompt covers this page's topic" is not
    -- something SQL can decide, and guessing it would put a made-up reason on
    -- a finding; a URL a customer attached to a prompt is a fact.
    select
      lower(public.normalize_page_path(ptu.url)) as page_key,
      count(distinct ptu.prompt_id)::bigint as targeting_prompts
    from public.prompt_target_urls ptu
    join public.prompts p on p.id = ptu.prompt_id
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
    group by 1
  ),
  pages as (
    select
      lower(public.normalize_page_path(gps.landing_page)) as page_key,
      min(public.normalize_page_path(gps.landing_page)) as landing_page,
      sum(gps.sessions)::bigint as sessions,
      sum(gps.engaged_sessions)::bigint as engaged_sessions,
      sum(gps.key_events)::bigint as key_events,
      sum(gps.transactions)::bigint as transactions,
      sum(gps.purchase_revenue) as revenue,
      sum(gps.engagement_duration_seconds)::bigint as engagement_seconds
    from public.ga_page_stats gps
    where gps.brand_id = p_brand_id
      and gps.date >= p_since
    group by 1
  ),
  ai as (
    select
      lower(public.normalize_page_path(gat.landing_page)) as page_key,
      sum(gat.sessions)::bigint as ai_sessions,
      array_remove(array_agg(distinct gat.platform), null) as ai_platforms
    from public.ga_ai_traffic_stats gat
    where gat.brand_id = p_brand_id
      and gat.date >= p_since
      and gat.landing_page <> ''
    group by 1
  )
  select
    p.landing_page,
    p.sessions,
    p.engaged_sessions,
    p.key_events,
    p.transactions,
    p.revenue,
    p.engagement_seconds,
    coalesce(a.ai_sessions, 0),
    coalesce(a.ai_platforms, '{}'::text[]),
    coalesce(c.citations, 0),
    coalesce(c.citing_prompts, 0),
    coalesce(t.targeting_prompts, 0)
  from pages p
  left join ai a on a.page_key = p.page_key
  left join cited c on c.page_key = p.page_key
  left join targeted t on t.page_key = p.page_key;
$$;

revoke all on function public.ga_page_ai_visibility(uuid, date) from public;
grant execute on function public.ga_page_ai_visibility(uuid, date) to service_role;

comment on function public.ga_page_ai_visibility(uuid, date) is
  'Per landing page for one brand (#719): Analytics totals, AI-referred sessions, own-domain citations and prompt targeting. Feeds nightly detection; the surface reads the findings it produces, not this.';

-- ─── What the finding now records ───────────────────────────────────────────
--
-- citation_state is nullable rather than defaulted, because a default would
-- be a claim. The findings already stored were raised before any of this was
-- measured, and stamping them 'not_targeted' would tell a customer nothing
-- points at a page that five of sixteen times is cited. Null means "not
-- classified yet"; the next nightly run fills it and the surface says nothing
-- until then.
alter table public.page_opportunities
  add column if not exists citation_state text,
  add column if not exists citations integer not null default 0,
  add column if not exists citing_prompts integer not null default 0,
  add column if not exists targeting_prompts integer not null default 0;

alter table public.page_opportunities
  drop constraint if exists page_opportunities_citation_state_check;

alter table public.page_opportunities
  add constraint page_opportunities_citation_state_check
  check (
    citation_state is null
    or citation_state = any (array['cited'::text, 'targeted_not_cited'::text, 'not_targeted'::text])
  );

comment on column public.page_opportunities.citation_state is
  'Why this page gets no AI traffic (#719): cited anyway, targeted by a prompt and not cited, or not targeted at all. Null until the first run that classifies it.';
