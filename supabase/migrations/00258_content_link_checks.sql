-- ============================================================================
-- 00258: the pages a Content Editor draft links to, read once a day
-- (Content Editor Quality, Trust)
-- ============================================================================
-- Trust's "No broken links" and "Fresh sources (≤ 24 months)" (Quality spec
-- §2.2) read each link a saved draft has: does it answer, and how old is the
-- page it points to. The server reads a link at most once a day (an
-- 'unknown' answer again after a few hours), whoever's draft has it; this is
-- that read. It holds only what any visitor of the linked page sees, so it
-- is shared, and only the server touches it. Rows go after a week.
--
--   * url_hash: sha256 of the link as the check keys it (no hash, no
--     tracking parameters); url is that link.
--   * status: 'ok' (it answers, a page or a file), 'broken' (gone, or the
--     site is nowhere), 'unknown' (it wouldn't tell: slow, a bot wall, a
--     server or certificate error that may pass).
--   * page_date: the page's own newest date (its main JSON-LD entity, else
--     its article:* meta, else the first <time> in its article), or null.

create table if not exists public.content_link_checks (
  url_hash text primary key check (char_length(url_hash) = 64),
  url text not null check (char_length(url) <= 2048),
  status text not null check (status in ('ok', 'broken', 'unknown')),
  http_status integer,
  page_date timestamptz,
  checked_at timestamptz not null default now()
);

create index if not exists content_link_checks_checked_at
  on public.content_link_checks (checked_at);

-- Service-role only, no policy.
alter table public.content_link_checks enable row level security;
revoke all on table public.content_link_checks from anon, authenticated;
grant all on table public.content_link_checks to service_role;

comment on table public.content_link_checks is
  'Content Editor Quality (Trust): each linked page''s last read — answers or not, and its own date. Server only; read at most once a day, kept a week.';
