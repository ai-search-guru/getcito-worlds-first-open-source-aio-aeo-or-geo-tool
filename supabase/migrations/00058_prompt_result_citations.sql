-- Citations as rows (#732), phase 1: the tables and the write path.
--
-- `prompt_results.citations` holds the provider's citation array as jsonb.
-- Reading it means expanding every answer on every page load: on the largest
-- brand, 51,679 answers become 679,304 citation entries, and pulling the host
-- out of each URL costs 4.4s of the 4.6s an aggregate over that window takes —
-- above the 8s statement timeout once anything else is asked for. The Citations
-- page works around it by paging the raw rows out to the app tier instead: 50
-- sequential requests carrying 65 MB of jsonb, capped at 50,000 rows, which
-- silently truncates that same brand at 51,679.
--
-- Expanding once at write time turns that into an ordinary indexed read.
--
-- Two tables rather than one, because the naive shape does not fit. Across the
-- database there are 2,023,979 citation entries but only 449,559 distinct URLs
-- — the expensive part (url ~92 bytes, title ~63) repeats 4.5 times on
-- average. One row per citation with the text inline measures 513 MB of heap
-- against 262 MB split this way, and the instance has 2 GB of RAM to hold a
-- database that is already 1.1 GB.
--
-- Phase 1 only fills the tables; nothing reads them yet. The Citations page
-- keeps using the jsonb until phase 2 lands the aggregate RPC, so the two can
-- be compared against each other before anything switches over.

-- ─── Dictionary ──────────────────────────────────────────────────────────────

create table if not exists public.citation_urls (
  id bigint generated always as identity primary key,
  -- Truncated to 2048 chars on write. The longest URL observed is 1,333, and
  -- a btree entry cannot exceed ~2,704 bytes — without a bound, one absurd URL
  -- would fail the unique index and take the whole result insert with it.
  url text not null,
  -- Host without `www.`, lowercased. Derived from the URL at write time so a
  -- domain rollup never has to parse 2M strings; the application's
  -- extractHostname() is the single definition of how.
  domain text not null,
  -- Whatever title the provider sent the first time this URL appeared.
  -- Providers word the same page differently between answers, and one stable
  -- label beats re-deciding per citation.
  title text,
  first_seen_at timestamptz not null default now()
);

create unique index if not exists citation_urls_url_key on public.citation_urls (url);
create index if not exists citation_urls_domain_idx on public.citation_urls (domain);

-- ─── Facts ───────────────────────────────────────────────────────────────────

create table if not exists public.prompt_result_citations (
  prompt_result_id uuid not null references public.prompt_results(id) on delete cascade,
  -- Index within the answer's citation array. With prompt_result_id this is
  -- the natural identity of a citation, which is what keeps the write path and
  -- the backfill idempotent when either re-runs over the same answer.
  position integer not null,
  url_id bigint not null references public.citation_urls(id),

  -- Denormalized from the parent answer. brand_id carries the row-level
  -- security rule, which cannot be expressed through a join, and created_at
  -- lets a brand's window be read without touching prompt_results — the table
  -- whose 1 GB of TOAST this change exists to stop reading.
  brand_id uuid not null references public.brands(id) on delete cascade,
  created_at timestamptz not null,

  primary key (prompt_result_id, position)
);

-- The Citations page always asks the same question first: this brand, this
-- window. Everything else narrows what comes back.
create index if not exists prompt_result_citations_brand_created_idx
  on public.prompt_result_citations (brand_id, created_at desc);

-- Reverse lookup: which answers cited this URL.
create index if not exists prompt_result_citations_url_idx
  on public.prompt_result_citations (url_id);

-- ─── Row level security ──────────────────────────────────────────────────────

alter table public.prompt_result_citations enable row level security;

-- Mirrors prompt_results and prompt_result_shopping_cards: org members read
-- their own org's rows, the service role writes. The worker goes through
-- supabaseAdmin and bypasses RLS, but the explicit policy keeps the table
-- reachable from an authenticated surface.
create policy "citations: org member select"
  on public.prompt_result_citations
  for select
  using (
    brand_id in (
      select b.id
      from public.brands b
      where b.organization_id in (
        select organization_id
        from public.profiles
        where id = auth.uid()
      )
    )
  );

create policy "Service role can insert citations"
  on public.prompt_result_citations
  for insert
  with check (true);

create policy "Service role can delete citations"
  on public.prompt_result_citations
  for delete
  using (true);

-- The dictionary is shared across every organization and has no tenant column,
-- so no row-level rule can express who may read a given URL — the answer lives
-- in the join, not in the row. RLS is therefore enabled with no select policy
-- at all: direct reads are denied to everyone but the service role, and the
-- phase 2 aggregate function will reach it as SECURITY DEFINER after checking
-- the caller owns the brand it was asked about. Adding a permissive policy
-- here would let any authenticated user enumerate every URL ever cited for
-- every customer.
alter table public.citation_urls enable row level security;

create policy "Service role can insert citation urls"
  on public.citation_urls
  for insert
  with check (true);

comment on table public.prompt_result_citations is
  'One row per citation per answer (#732). Written alongside prompt_results by the tracking worker and the Cloro webhook handler, and backfilled by backend/src/scripts/backfillCitations.js. Source of truth for the Citations page from phase 2 onward; prompt_results.citations remains the raw archival copy.';
comment on table public.citation_urls is
  'Deduplicated URL dictionary for prompt_result_citations. Cross-tenant by design: the same page is cited for many brands, and storing the text once is what keeps the citation table a quarter of the size it would otherwise be.';
comment on column public.prompt_result_citations.position is
  'Index within prompt_results.citations. With prompt_result_id it is the natural key that makes re-running the write path or the backfill idempotent.';
