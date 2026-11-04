-- Prompt clusters: the unit content opportunities will be generated for (#857).
--
-- Opportunities are generated per prompt today, so one need asked eight ways
-- yields eight near-identical suggestions and most prompts get none. A
-- cluster is a group of prompts in the same topic that share one intent:
-- one piece of content can answer all of them.
--
-- Clusters are built per scope — a topic, or a brand's prompts with no topic
-- (topic_id null) — by the server, and rebuilt only when the scope's active
-- prompts change. prompt_cluster_scopes records what each scope was last
-- clustered from. A rebuild keeps a cluster's id when its membership mostly
-- survives, so whatever is attached to a cluster later outlives a re-run.
--
-- prompt_cluster_queries is the cluster's fan-out basket: the sub-queries AI
-- engines searched while answering the cluster's prompts, each judged once as
-- relevant to the cluster and brand (included) or not (excluded).
--
-- The server writes all three through the service role; members read them.

create table public.prompt_clusters (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Null is the scope of prompts with no topic.
  topic_id uuid references public.topics(id) on delete cascade,
  label text not null,
  primary_intent text not null,
  secondary_intents text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index prompt_clusters_brand_topic_idx
  on public.prompt_clusters (brand_id, topic_id);

-- A prompt belongs to exactly one cluster.
create table public.prompt_cluster_members (
  prompt_id uuid primary key references public.prompts(id) on delete cascade,
  cluster_id uuid not null references public.prompt_clusters(id) on delete cascade
);

create index prompt_cluster_members_cluster_idx
  on public.prompt_cluster_members (cluster_id);

create table public.prompt_cluster_scopes (
  brand_id uuid not null references public.brands(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete cascade,
  -- Hash of the scope's active prompts (id and text) at the last clustering.
  fingerprint text not null,
  clustered_at timestamptz not null default now(),
  unique nulls not distinct (brand_id, topic_id)
);

create table public.prompt_cluster_queries (
  cluster_id uuid not null references public.prompt_clusters(id) on delete cascade,
  -- Normalized: trimmed, whitespace collapsed, lower-cased.
  query text not null,
  -- Answers in the window that searched this query, across the cluster.
  times_searched integer not null,
  included boolean not null,
  reason text not null default '',
  judged_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (cluster_id, query)
);

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.prompt_clusters enable row level security;
alter table public.prompt_cluster_members enable row level security;
alter table public.prompt_cluster_scopes enable row level security;
alter table public.prompt_cluster_queries enable row level security;

create policy "prompt_clusters: member select"
  on public.prompt_clusters
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "prompt_cluster_members: member select"
  on public.prompt_cluster_members
  for select
  using (
    cluster_id in (
      select c.id
      from public.prompt_clusters c
      join public.brands b on b.id = c.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "prompt_cluster_scopes: member select"
  on public.prompt_cluster_scopes
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

create policy "prompt_cluster_queries: member select"
  on public.prompt_cluster_queries
  for select
  using (
    cluster_id in (
      select c.id
      from public.prompt_clusters c
      join public.brands b on b.id = c.brand_id
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

-- ─── Writes ──────────────────────────────────────────────────────────────────

-- Replaces one scope's clusters in a single statement, so a reader never sees
-- a scope half-rebuilt. p_clusters is [{id, label, primary_intent,
-- secondary_intents, prompt_ids}]; id is an existing cluster of the scope to
-- keep, or null for a new one. The scope's other clusters are deleted.
create or replace function public.replace_prompt_clusters(
  p_brand_id uuid,
  p_topic_id uuid,
  p_fingerprint text,
  p_clusters jsonb
) returns void
language plpgsql
set search_path = public
as $$
declare
  c jsonb;
  cid uuid;
  kept uuid[] := '{}';
begin
  for c in select * from jsonb_array_elements(p_clusters) loop
    cid := nullif(c->>'id', '')::uuid;

    if cid is not null then
      update prompt_clusters
         set label = c->>'label',
             primary_intent = c->>'primary_intent',
             secondary_intents = array(select jsonb_array_elements_text(c->'secondary_intents')),
             updated_at = now()
       where id = cid
         and brand_id = p_brand_id
         and topic_id is not distinct from p_topic_id;
      if not found then
        cid := null;
      end if;
    end if;

    if cid is null then
      insert into prompt_clusters (brand_id, topic_id, label, primary_intent, secondary_intents)
      values (
        p_brand_id,
        p_topic_id,
        c->>'label',
        c->>'primary_intent',
        array(select jsonb_array_elements_text(c->'secondary_intents'))
      )
      returning id into cid;
    end if;

    kept := kept || cid;

    insert into prompt_cluster_members (prompt_id, cluster_id)
    select pid::uuid, cid
    from jsonb_array_elements_text(c->'prompt_ids') pid
    on conflict (prompt_id) do update set cluster_id = excluded.cluster_id;
  end loop;

  -- Prompts that left the scope or went inactive, still pointing at a kept
  -- cluster.
  delete from prompt_cluster_members m
   where m.cluster_id = any(kept)
     and not exists (
       select 1
       from jsonb_array_elements(p_clusters) c2,
            jsonb_array_elements_text(c2->'prompt_ids') pid
       where pid::uuid = m.prompt_id
     );

  delete from prompt_clusters
   where brand_id = p_brand_id
     and topic_id is not distinct from p_topic_id
     and id <> all(kept);

  insert into prompt_cluster_scopes (brand_id, topic_id, fingerprint, clustered_at)
  values (p_brand_id, p_topic_id, p_fingerprint, now())
  on conflict (brand_id, topic_id) do update
    set fingerprint = excluded.fingerprint,
        clustered_at = excluded.clustered_at;
end;
$$;

revoke all on function public.replace_prompt_clusters(uuid, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.replace_prompt_clusters(uuid, uuid, text, jsonb) to service_role;

-- ─── Reads ───────────────────────────────────────────────────────────────────

-- A brand's fan-out sub-queries in a window, per prompt, keeping only queries
-- searched in at least p_min_answers answers across the brand. Counting
-- matches report_query_fanout: once per answer however often the answer
-- repeats it. Returned as one jsonb array of [prompt_id, query,
-- times_searched], so PostgREST's row cap does not apply: the largest brand
-- has about 5,700 such rows a month.
create or replace function public.brand_prompt_fanout_queries(
  p_brand_id uuid,
  p_since timestamptz,
  p_min_answers integer default 2
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with items as (
    select
      pr.id as result_id,
      pr.prompt_id,
      lower(btrim(regexp_replace(it->>'query', '\s+', ' ', 'g'))) as query
    from prompt_results pr
    cross join lateral jsonb_array_elements(pr.search_queries) it
    where pr.brand_id = p_brand_id
      and pr.created_at >= p_since
      and jsonb_typeof(pr.search_queries) = 'array'
      and it->>'query' is not null
  ),
  frequent as (
    select i.query
    from items i
    where i.query <> ''
    group by i.query
    having count(distinct i.result_id) >= p_min_answers
  )
  select coalesce(jsonb_agg(jsonb_build_array(r.prompt_id, r.query, r.n)), '[]'::jsonb)
  from (
    select i.prompt_id, i.query, count(distinct i.result_id) as n
    from items i
    join frequent f on f.query = i.query
    group by i.prompt_id, i.query
  ) r;
$$;

revoke all on function public.brand_prompt_fanout_queries(uuid, timestamptz, integer) from public, anon, authenticated;
grant execute on function public.brand_prompt_fanout_queries(uuid, timestamptz, integer) to service_role;

comment on table public.prompt_clusters is 'Groups of prompts in one topic (or the no-topic scope) that share one intent; the unit content opportunities are generated for (#857).';
