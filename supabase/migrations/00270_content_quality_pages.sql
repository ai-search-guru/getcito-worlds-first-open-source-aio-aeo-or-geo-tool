-- ============================================================================
-- 00270: Quality phase 2, CE-049 — a page's visual proof spots and proof asks
-- ============================================================================
-- Quality's dynamic suggestions (spec §4b) read the whole page, with its page
-- type and the brand's business type (B2B, B2C, e-commerce):
--
--   * visual proof spots: where one specific image the business can take
--     itself (a screenshot of its own tool's result, a photo of this product
--     in use) would prove what a paragraph says; three a page at most, one
--     an H2 section, none when no specific image fits;
--   * proof asks: claims the business makes about itself whose proof only it
--     has (an award, a certification, its own test, a rating, a ranking, its
--     own figure, a named customer), each with the kind of proof it needs;
--   * whether the page advises consumers on health, finance or law (a
--     qualified reviewer is asked for).
--
-- content_quality_pages keeps the last read of each draft, by a hash of its
-- headings, paragraphs and types: an unchanged page isn't read again. Each
-- item names its paragraph by the hash the claims read keeps it by (00266),
-- so an item whose paragraph changed drops out. `missed` marks a read whose
-- answer missed the schema: read again after a day. `day_reads` counts the
-- reads since `day_started_at` (a draft's page reads a day are capped).
-- Server-only.
--
-- content_draft_own_images: the images a member confirmed are their own,
-- not stock (E-E-A-T's visual proof): only the person can tell, so it is
-- their statement, kept with who made it. An image is named by its address;
-- a new address is confirmed again. 50 a draft at most.

create table if not exists public.content_quality_pages (
  draft_id uuid primary key references public.content_drafts(id) on delete cascade,
  page_hash text not null check (page_hash ~ '^[0-9a-f]{16}$'),
  site_type text not null check (site_type in ('b2b', 'ecommerce', 'b2c')),
  page_type text check (page_type is null or char_length(page_type) <= 50),
  -- [{ "passage", "block_hash", "image", "alt" }]
  spots jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(spots) = 'array'
      and jsonb_array_length(spots) <= 3
      and octet_length(spots::text) <= 8192
    ),
  -- [{ "claim", "block_hash", "kind" }]
  proofs jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(proofs) = 'array'
      and jsonb_array_length(proofs) <= 8
      and octet_length(proofs::text) <= 8192
    ),
  regulated text check (regulated is null or regulated in ('health', 'finance', 'legal')),
  model text check (model is null or char_length(model) <= 100),
  missed boolean not null default false,
  read_at timestamptz not null default now(),
  day_reads smallint not null default 0 check (day_reads >= 0),
  day_started_at timestamptz
);

alter table public.content_quality_pages enable row level security;
revoke all on table public.content_quality_pages from anon, authenticated;
grant all on table public.content_quality_pages to service_role;

comment on table public.content_quality_pages is
  'Quality CE-049 (00270): the last read of a draft''s page for visual proof spots and proof asks, by a hash of its headings, paragraphs and types; items name their paragraph by its hash (00266). Server-only.';

create table if not exists public.content_draft_own_images (
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  src text not null check (char_length(src) between 8 and 2048 and src ~ '^https?://'),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (draft_id, src)
);

alter table public.content_draft_own_images enable row level security;
revoke all on table public.content_draft_own_images from anon, authenticated;
grant select, insert on table public.content_draft_own_images to authenticated;
grant all on table public.content_draft_own_images to service_role;

drop policy if exists "content_draft_own_images: member select" on public.content_draft_own_images;
create policy "content_draft_own_images: member select"
  on public.content_draft_own_images
  for select
  using (public.content_draft_member(draft_id));

-- A member confirms as themself, now.
drop policy if exists "content_draft_own_images: member insert" on public.content_draft_own_images;
create policy "content_draft_own_images: member insert"
  on public.content_draft_own_images
  for insert
  with check (
    public.content_draft_member(draft_id)
    and confirmed_by = auth.uid()
    and confirmed_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

create or replace function public.content_draft_own_images_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One confirm at a time a draft, so the count holds.
  perform pg_advisory_xact_lock(hashtext('content_draft_own_images'), hashtext(new.draft_id::text));
  -- Confirmed already: the insert's ON CONFLICT leaves it as it is.
  if exists (
    select 1 from public.content_draft_own_images where draft_id = new.draft_id and src = new.src
  ) then
    return new;
  end if;
  if (select count(*) from public.content_draft_own_images where draft_id = new.draft_id) >= 50 then
    raise exception 'A draft keeps 50 confirmed images at most' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_draft_own_images_cap on public.content_draft_own_images;
create trigger content_draft_own_images_cap
  before insert on public.content_draft_own_images
  for each row execute function public.content_draft_own_images_cap();

comment on table public.content_draft_own_images is
  'Quality CE-049 (00270): images a member confirmed are their own (E-E-A-T visual proof), by address, with who confirmed; 50 a draft at most. Members read and insert as themselves; no update or delete.';

notify pgrst, 'reload schema';
