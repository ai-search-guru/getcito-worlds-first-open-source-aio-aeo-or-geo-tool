-- ============================================================================
-- 00266: Quality phase 2, CE-045 — the claims in a draft's own words
-- ============================================================================
-- Trust wants a source for every claim on a page. Phase 1 reads figures by
-- rule; phase 2 has the model read the person's own paragraphs for the
-- claims a rule can't see: research ("studies show"), superlatives ("the
-- fastest"), awards and certifications ("SOC 2"), product facts
-- ("waterproof"). The editor underlines one with no source in its block.
--
-- What the model read is kept per draft and paragraph, by a hash of the
-- paragraph's words: a paragraph not changed since isn't read again, and the
-- rows of paragraphs no longer on the page go at the next read. Each claim
-- is { "text", "kind" }: its words as the paragraph has them, and number,
-- stat, superlative or fact. `missed` marks a paragraph whose answer missed
-- the schema (cut short, or blocked by the provider's filter): kept as read
-- with no claims, so it isn't charged on every save, and read again after a
-- day. Server-only: the API reads and writes it, after its own check that
-- the caller is a member of the draft's workspace.

create table if not exists public.content_quality_claims (
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  paragraph_hash text not null check (paragraph_hash ~ '^[0-9a-f]{16}$'),
  claims jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(claims) = 'array'
      and jsonb_array_length(claims) <= 5
      and octet_length(claims::text) <= 4096
    ),
  model text check (model is null or char_length(model) <= 100),
  missed boolean not null default false,
  checked_at timestamptz not null default now(),
  primary key (draft_id, paragraph_hash)
);

alter table public.content_quality_claims enable row level security;
revoke all on table public.content_quality_claims from anon, authenticated;
grant all on table public.content_quality_claims to service_role;

comment on table public.content_quality_claims is
  'Quality CE-045 (00266): the claims the model read in a draft''s paragraph (number, stat, superlative or fact), by the paragraph''s hash; a changed paragraph is read again, a removed one''s row goes. Server-only.';

notify pgrst, 'reload schema';
