-- ============================================================================
-- 00161: What AI associates with each brand (Mentions & Sentiment, MS-09)
-- ============================================================================
-- The Perception tab asks what AI says next to a brand: the terms around its
-- mentions, how they compare with the competitors', and which competitors AI
-- names beside it. Spec §9 wants it deterministic in V1 (no LLM): the terms
-- come from the stored answers' text by rule.
--
--   * mention_terms(text, names, exclude) takes the sentences that name an
--     entity (a whole word, ignoring case) and returns their words and
--     two-word phrases, minus stop words in the languages tracked (Postgres'
--     Snowball dictionaries), a short list of words answers use about every
--     brand alike, and the words in `exclude`: every brand's and competitor's
--     names, and the question's own words (they would rank first for every
--     brand and say nothing about it). A phrase never spans a comma or a
--     bracket.
--   * mentions_answer_terms keeps, per answer and per entity it names (the
--     brand, or a competitor by id), the distinct terms. One row per answer
--     and entity, not per term per day: the page's filters (topic, search,
--     platform, country) and the window before stay available, and the table
--     grows with the answers, not with the vocabulary.
--   * refresh_mention_terms fills it for a UTC day range. The server calls it
--     beside refresh_mentions_daily (00157), for the same days and callers: a
--     completed run, the nightly sweep and backfillMentionsDaily.js. A
--     sentiment correction (00160) refreshes only the rollups.
--   * mentions_perception(...) reads a window and the one before it: the
--     brand's top terms with their trend, the attributes that tell the brand
--     and its four most mentioned competitors apart, with each one's share
--     of mentions, and the competitors named in the same answers as the
--     brand, now and before.
--
-- Terms describe what is said next to a brand, not who it is said about: a
-- sentence naming two brands lends its words to both. Spec §3 leaves themes
-- and polarity to the V1.5 classifier.

-- ─── Terms ──────────────────────────────────────────────────────────────────

create or replace function public.mention_stopword(p_word text)
returns boolean
language sql
stable
parallel safe
set search_path to 'public', 'pg_catalog'
as $$
  select p_word = any (array[
           'best', 'top', 'also', 'like', 'well', 'great', 'good', 'better', 'many', 'much',
           'more', 'most', 'other', 'others', 'one', 'two', 'three', 'first', 'second',
           'third', 'new', 'known', 'popular', 'option', 'options', 'choice', 'choices',
           'alternative', 'alternatives', 'include', 'includes', 'including', 'offer',
           'offers', 'offering', 'provide', 'provides', 'providing', 'list', 'lists',
           'brand', 'brands', 'company', 'companies', 'service', 'services', 'product',
           'products', 'platform', 'platforms', 'tool', 'tools', 'solution', 'solutions',
           'feature', 'features', 'use', 'used', 'using', 'user', 'users', 'customer',
           'customers', 'help', 'helps', 'make', 'makes', 'get', 'gets', 'often',
           'especially', 'consider', 'considered', 'overall', 'recommend', 'recommended',
           'highly', 'rated', 'review', 'reviews', 'www', 'com', 'http', 'https', 'etc',
           'whether', 'however', 'although', 'though', 'still', 'even', 'just', 'really',
           'various', 'several', 'number', 'way', 'ways', 'thing', 'things', 'look',
           'looking', 'want', 'need', 'needs', 'depending', 'depends', 'based', 'pick',
           'picks', 'stand', 'stands', 'out', 'here', 'there', 'below', 'above',
           -- Where a brand sits in a list, not what it is.
           'ahead', 'behind', 'leads', 'lead', 'leading', 'comes', 'come', 'close',
           'closely', 'rank', 'ranks', 'ranked', 'spot', 'place', 'placed', 'followed',
           'follows', 'next', 'usual',
           -- How answers talk about anything.
           'solid', 'say', 'says', 'said', 'buyer', 'buyers', 'people', 'focus', 'focuses',
           'focused', 'mention', 'mentions', 'mentioned', 'reviewer', 'reviewers', 'start',
           'starts', 'starting', 'wants', 'worth', 'available'])
      or ts_lexize('english_stem', p_word) = '{}'
      or ts_lexize('german_stem', p_word) = '{}'
      or ts_lexize('french_stem', p_word) = '{}'
      or ts_lexize('spanish_stem', p_word) = '{}'
      or ts_lexize('italian_stem', p_word) = '{}'
      or ts_lexize('portuguese_stem', p_word) = '{}'
      or ts_lexize('dutch_stem', p_word) = '{}'
      or ts_lexize('turkish_stem', p_word) = '{}'
      or ts_lexize('swedish_stem', p_word) = '{}'
      or ts_lexize('danish_stem', p_word) = '{}'
      or ts_lexize('norwegian_stem', p_word) = '{}'
      or ts_lexize('finnish_stem', p_word) = '{}'
      or ts_lexize('russian_stem', p_word) = '{}';
$$;

create or replace function public.mention_terms(p_text text, p_names text[], p_exclude text[])
returns text[]
language sql
stable
parallel safe
set search_path to 'public', 'pg_catalog'
as $$
  with clean as (
    -- ChatGPT's entity tags read as their names, links as their labels, bare
    -- URLs and markdown marks dropped.
    select regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p_text, ''),
             '<Entity[^>]*?value="([^"]*)"[^>]*/>', '\1', 'g'),
             '\[([^\]]*)\]\([^)]*\)', '\1', 'g'),
             'https?://[^[:space:])>\]]+', ' ', 'g'),
             '[*_`#>]+', ' ', 'g') as t
  ),
  sentences as (
    select s.sentence, s.n
    from clean,
         regexp_split_to_table(clean.t, '[.!?]+[[:space:]]+|\n+') with ordinality as s(sentence, n)
    where exists (
      select 1 from unnest(p_names) nm
      where length(btrim(nm)) > 0
        and s.sentence ~* ('(^|[^[:alnum:]])'
             || regexp_replace(btrim(nm), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g')
             || '($|[^[:alnum:]])'))
  ),
  -- A phrase never spans a comma, a colon or a bracket.
  chunks as (
    select s.n as sn, c.chunk, c.cn
    from sentences s,
         regexp_split_to_table(s.sentence, '[,;:()"“”\[\]]+') with ordinality as c(chunk, cn)
  ),
  tokens as (
    select ch.sn, ch.cn, w.pos, btrim(w.word, '-') as word
    from chunks ch,
         regexp_split_to_table(lower(ch.chunk), '[^[:alnum:]-]+') with ordinality as w(word, pos)
  ),
  -- Each distinct word is looked up once.
  words as (
    select word from (select distinct word from tokens) d
    where length(word) >= 3
      and word !~ '^[0-9-]+$'
      and not (word = any (coalesce(p_exclude, '{}')))
      and not public.mention_stopword(word)
  ),
  kept as (
    select t.sn, t.cn, t.pos, t.word from tokens t join words w on w.word = t.word
  )
  select coalesce(array_agg(distinct term order by term), '{}')
  from (
    select word as term from kept
    union all
    select k1.word || ' ' || k2.word
    from kept k1
    join kept k2 on k2.sn = k1.sn and k2.cn = k1.cn and k2.pos = k1.pos + 1
  ) t;
$$;

-- ─── Per answer and entity ──────────────────────────────────────────────────

create table if not exists public.mentions_answer_terms (
  brand_id    uuid not null references public.brands(id) on delete cascade,
  result_id   uuid not null references public.prompt_results(id) on delete cascade,
  created_at  timestamptz not null,
  prompt_id   uuid not null,
  platform    text not null,
  region      text,
  -- 'brand', or the competitor's id.
  entity      text not null,
  terms       text[] not null default '{}',
  primary key (result_id, entity)
);

create index if not exists idx_mentions_answer_terms_brand_created
  on public.mentions_answer_terms (brand_id, created_at);

alter table public.mentions_answer_terms enable row level security;

create policy "Users can read own org mention terms"
  on public.mentions_answer_terms for select
  using (brand_id in (
    select b.id from public.brands b
    join public.profiles p on p.organization_id = b.organization_id
    where p.id = auth.uid()));

-- ─── Refresh the answer terms ───────────────────────────────────────────────
-- Recomputes the terms of a brand's answers for an inclusive UTC day range:
-- delete + insert, as refresh_mentions_daily (00157) does for the rollups.
-- Its own function rather than part of that refresh: reading every answer's
-- text costs a few milliseconds per answer and entity named, seconds per day
-- on the largest brands, and a sentiment correction (00160) refreshes the
-- rollups inside the person's request, where terms never change. The server
-- calls both for a completed run, the nightly sweep and the backfill
-- (backend/src/lib/mentionsRollups.js). Service-role only.

create or replace function public.refresh_mention_terms(
  p_brand_id uuid,
  p_day_from date,
  p_day_to   date
) returns void
language plpgsql
set search_path to 'public'
as $$
declare
  -- The range's bounds as instants, so the answers are found by range.
  v_from timestamptz := p_day_from::timestamp at time zone 'utc';
  v_to   timestamptz := (p_day_to + 1)::timestamp at time zone 'utc';
begin
  -- One refresh per brand at a time, as refresh_mentions_daily (00192): a
  -- run's refresh and the nightly sweep can cover the same days, and the
  -- second insert would fail on the (result_id, entity) key. The lock
  -- releases at commit.
  perform pg_advisory_xact_lock(
    hashtextextended('refresh_mention_terms:' || p_brand_id::text, 0));

  delete from public.mentions_answer_terms
    where brand_id = p_brand_id and created_at >= v_from and created_at < v_to;

  -- The terms next to each entity an answer names, matched by the same names
  -- tracking counts: the brand's name and domains, each competitor's name
  -- and domain.
  with brand_names as (
    select array_remove(array[b.name] || coalesce(
             (select array_agg(bd.domain) from public.brand_domains bd where bd.brand_id = b.id),
             '{}'), null) as names
    from public.brands b
    where b.id = p_brand_id
  ),
  competitor_names as (
    select c.id::text as entity, array_remove(array[c.name, nullif(c.domain, '')], null) as names
    from public.competitors c
    where c.brand_id = p_brand_id
  ),
  name_words as (
    select coalesce(array_agg(distinct w), '{}') as words
    from (
      select regexp_split_to_table(lower(n), '[^[:alnum:]-]+') as w
      from (
        select unnest(names) as n from brand_names
        union all
        select unnest(names) from competitor_names
      ) all_names
    ) split
    where w <> ''
  )
  insert into public.mentions_answer_terms (
    brand_id, result_id, created_at, prompt_id, platform, region, entity, terms)
  select
    p_brand_id, pr.id, pr.created_at, pr.prompt_id, pr.platform, pr.region, e.entity,
    public.mention_terms(
      pr.response,
      e.names,
      (select words from name_words) || regexp_split_to_array(lower(p.text), '[^[:alnum:]-]+'))
  from public.prompt_results pr
  join public.prompts p on p.id = pr.prompt_id
  cross join lateral (
    select 'brand'::text as entity, (select names from brand_names) as names
    where pr.mention_count > 0
    union all
    select cn.entity, cn.names
    from competitor_names cn
    where exists (
      select 1
      from jsonb_array_elements(coalesce(pr.competitor_mentions, '[]'::jsonb)) cm
      where cm.value->>'competitor_id' = cn.entity
        and coalesce((cm.value->>'mention_count')::int, 0) > 0)
  ) e
  where pr.brand_id = p_brand_id
    and pr.prompt_id is not null
    and pr.platform <> 'chatgpt-shopping'
    and pr.created_at >= v_from
    and pr.created_at < v_to;
end;
$$;

revoke execute on function public.refresh_mention_terms(uuid, date, date)
  from public, anon, authenticated;

-- ─── Read ───────────────────────────────────────────────────────────────────
-- The Perception tab's figures for a window and the window of the same length
-- before it (mentions_list's window, 00158: the exact instants under two
-- days, whole UTC days otherwise). jsonb:
--   window       { from, to, days }
--   entities     the brand, then up to four competitors by mentions:
--                { entity, name, is_brand, mentions, prev_mentions }
--   brand_terms  the brand's 15 top terms: { term, answers, prev_answers }
--   attributes   the 8 terms that tell those entities apart most (the widest
--                spread of shares of mentions): { term, values: [{ entity, answers }] }
-- A word that nearly always comes in one phrase is listed as that phrase.
--   co_mentions  every competitor named in the same answers as the brand:
--                { competitor_id, name, co_mentions, prev_co_mentions }
-- Filters: platform, region, topic, and the prompt-text search.

create or replace function public.mentions_perception(
  p_brand_id  uuid,
  p_date_from timestamptz,
  p_date_to   timestamptz default null,
  p_platform  text default null,
  p_region    text default null,
  p_topic_id  uuid default null,
  p_search    text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set work_mem to '64MB'
set plan_cache_mode to 'force_custom_plan'
as $$
declare
  v_to         timestamptz := coalesce(p_date_to, now());
  v_from       timestamptz := least(p_date_from, coalesce(p_date_to, now()));
  v_days       integer;
  v_day_to     date;
  v_start      timestamptz;
  v_end        timestamptz;
  v_prev_start timestamptz;
  v_search     text := nullif(btrim(lower(coalesce(p_search, ''))), '');
  v_result     jsonb;
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1 from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id and pf.id = auth.uid()
  ) then
    return null;
  end if;

  v_days := greatest(1, ceil(extract(epoch from v_to - v_from) / 86400.0 - 1.0 / 24)::integer);
  if v_days < 2 then
    v_start := v_from;
    v_end   := v_to + interval '1 microsecond';
  else
    v_day_to := (v_to at time zone 'utc')::date;
    v_start  := (v_day_to - (v_days - 1))::timestamp at time zone 'utc';
    v_end    := (v_day_to + 1)::timestamp at time zone 'utc';
  end if;
  v_prev_start := v_start - (v_end - v_start);

  with
  prompts_in as (
    select p.id
    from public.prompts p
    join public.prompt_sets ps on ps.id = p.prompt_set_id
    where ps.brand_id = p_brand_id
      and (p_topic_id is null or p.topic_id = p_topic_id)
      and (v_search is null or position(v_search in lower(p.text)) > 0)
  ),
  rows_in as (
    select t.result_id, t.entity, t.terms, (t.created_at >= v_start) as cur
    from public.mentions_answer_terms t
    join prompts_in pi on pi.id = t.prompt_id
    where t.brand_id = p_brand_id
      and t.created_at >= v_prev_start
      and t.created_at < v_end
      and (p_platform is null or t.platform = p_platform)
      and (p_region is null or t.region = p_region)
  ),
  entity_counts as (
    select entity,
           count(*) filter (where cur)     as mentions,
           count(*) filter (where not cur) as prev_mentions
    from rows_in
    group by entity
  ),
  shown as (
    select 'brand'::text as entity, 0 as rank
    union all
    select * from (
      select ec.entity, row_number() over (order by ec.mentions desc, ec.entity)::int
      from entity_counts ec
      join public.competitors co on co.id::text = ec.entity and co.brand_id = p_brand_id
      where ec.mentions > 0
      order by ec.mentions desc, ec.entity
      limit 4
    ) top_competitors
  ),
  term_counts_all as (
    select r.entity, term,
           count(*) filter (where r.cur)     as answers,
           count(*) filter (where not r.cur) as prev_answers
    from rows_in r
    join shown s on s.entity = r.entity
    cross join lateral unnest(r.terms) as term
    group by r.entity, term
  ),
  -- Each entity's 60 most frequent terms are the candidates.
  candidates as (
    select entity, term, answers, prev_answers
    from (
      select t.*, row_number() over (partition by t.entity order by t.answers desc, t.term) as rn
      from term_counts_all t
      where t.answers > 0
    ) ranked
    where rn <= 60
  ),
  -- A word that nearly always comes in one phrase is that phrase: "fresh" and
  -- "roast" give way to "fresh roast" when it has 80% of their answers.
  term_counts as (
    select c.*
    from candidates c
    where position(' ' in c.term) > 0
       or not exists (
         select 1 from candidates p
         where p.entity = c.entity
           and position(' ' in p.term) > 0
           and (p.term like c.term || ' %' or p.term like '% ' || c.term)
           and p.answers >= 0.8 * c.answers)
  ),
  brand_terms as (
    select term, answers, prev_answers
    from term_counts
    where entity = 'brand' and answers > 0
    order by answers desc, term
    limit 15
  ),
  -- The terms that tell the brands apart most: the widest spread between the
  -- highest and lowest share of mentions, then the highest shares.
  attributes as (
    select u.term
    from (select distinct term from term_counts) u
    cross join shown s
    left join term_counts_all tc on tc.entity = s.entity and tc.term = u.term
    left join entity_counts ec on ec.entity = s.entity
    group by u.term
    order by
      max(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0))
        - min(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      sum(coalesce(tc.answers, 0)::numeric / nullif(ec.mentions, 0)) desc nulls last,
      u.term
    limit 8
  ),
  -- A competitor's rows in answers that name the brand too, in one pass.
  co as (
    select x.entity,
           count(*) filter (where x.cur)     as co_mentions,
           count(*) filter (where not x.cur) as prev_co_mentions
    from (
      select r.entity, r.cur,
             bool_or(r.entity = 'brand') over (partition by r.result_id) as with_brand
      from rows_in r
    ) x
    where x.entity <> 'brand' and x.with_brand
    group by x.entity
  )
  select jsonb_build_object(
    'window', jsonb_build_object('from', v_start, 'to', v_end, 'days', v_days),
    'entities', coalesce((
      select jsonb_agg(jsonb_build_object(
               'entity', s.entity,
               'name', case when s.entity = 'brand' then b.name else co.name end,
               'is_brand', s.entity = 'brand',
               'mentions', coalesce(ec.mentions, 0),
               'prev_mentions', coalesce(ec.prev_mentions, 0))
             order by s.rank)
      from shown s
      left join entity_counts ec on ec.entity = s.entity
      left join public.brands b on s.entity = 'brand' and b.id = p_brand_id
      left join public.competitors co on co.id::text = s.entity and co.brand_id = p_brand_id
    ), '[]'::jsonb),
    'brand_terms', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', bt.term, 'answers', bt.answers, 'prev_answers', bt.prev_answers)
             order by bt.answers desc, bt.term)
      from brand_terms bt
    ), '[]'::jsonb),
    'attributes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'term', a.term,
               'values', (
                 select jsonb_agg(jsonb_build_object(
                          'entity', s.entity, 'answers', coalesce(tc.answers, 0))
                        order by s.rank)
                 from shown s
                 left join term_counts_all tc on tc.entity = s.entity and tc.term = a.term)))
      from attributes a
    ), '[]'::jsonb),
    'co_mentions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'competitor_id', c.entity,
               'name', comp.name,
               'co_mentions', c.co_mentions,
               'prev_co_mentions', c.prev_co_mentions)
             order by c.co_mentions desc, comp.name)
      from co c
      join public.competitors comp on comp.id::text = c.entity and comp.brand_id = p_brand_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  from public, anon;
grant execute on function public.mentions_perception(uuid, timestamptz, timestamptz, text, text, uuid, text)
  to authenticated, service_role;
