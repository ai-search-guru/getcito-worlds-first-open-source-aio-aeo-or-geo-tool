-- ============================================================================
-- 00352: whether a page's shopping links still sell (shopping path, part 7)
-- ============================================================================
-- A buying guide, a best-of list or a comparison sends its readers, and the
-- AI answers that quote it, to the category pages and the products of its
-- shopping path (00351). A product sells out, Google Merchant Center refuses
-- it, or it leaves the catalog, and the page goes on linking it. After each
-- catalog sync the API reads every page with a shopping path again: the live
-- page where it is published (content_drafts.published_url, or an optimized
-- page's own address), else the draft, and keeps here what its links do with
-- the path. The Content Library shows it in its Shopping path column.
--
--   * One row per draft with a shopping path; it goes with the draft, and
--     the next check removes a row whose draft lost its path or was archived.
--   * `bad`: the linked products that no longer sell, [{id, title, state}]
--     with state sold_out, refused or gone, and `needs_attention` whether
--     there are any.
--   * Members read their brands' rows; the server writes them.

create table if not exists public.content_shopping_checks (
  draft_id uuid primary key references public.content_drafts(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  -- Where the links were read: the live page, or the draft when it isn't
  -- published or its page couldn't be read.
  read_from text not null check (read_from in ('page', 'draft')),
  page_url text check (
    page_url is null or (char_length(page_url) <= 2048 and page_url ~* '^https?://')
  ),
  -- The path's category pages and products, and how many of them the page links.
  categories smallint not null default 0 check (categories between 0 and 5),
  categories_linked smallint not null default 0,
  products smallint not null default 0 check (products between 0 and 40),
  products_linked smallint not null default 0,
  bad jsonb not null default '[]'::jsonb check (
    jsonb_typeof(bad) = 'array' and jsonb_array_length(bad) <= 40
  ),
  needs_attention boolean generated always as (
    jsonb_typeof(bad) = 'array' and jsonb_array_length(bad) > 0
  ) stored,
  checked_at timestamptz not null default now(),
  constraint content_shopping_checks_linked_check check (
    categories_linked between 0 and categories and products_linked between 0 and products
  )
);

create index if not exists content_shopping_checks_brand_idx
  on public.content_shopping_checks (brand_id, needs_attention);

alter table public.content_shopping_checks enable row level security;
revoke all on table public.content_shopping_checks from anon, authenticated;
grant select on table public.content_shopping_checks to authenticated;
grant all on table public.content_shopping_checks to service_role;

drop policy if exists "content_shopping_checks: member select" on public.content_shopping_checks;
create policy "content_shopping_checks: member select"
  on public.content_shopping_checks
  for select
  using (
    brand_id in (
      select b.id from public.brands b
      join public.profiles p on p.organization_id = b.organization_id
      where p.id = auth.uid()
    )
  );

comment on table public.content_shopping_checks is
  'Shopping path, part 7 (00352): what a page''s links do with its shopping path (00351) as the last catalog sync left the catalog: how many of its category pages and products it links, and the linked products that no longer sell (sold out, refused by Merchant Center, gone). Read from the live page when published, else the draft. Server writes, members read.';

notify pgrst, 'reload schema';
