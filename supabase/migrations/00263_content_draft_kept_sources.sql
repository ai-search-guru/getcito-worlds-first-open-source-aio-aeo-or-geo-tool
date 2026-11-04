-- ============================================================================
-- 00263: Quality phase 2, CE-046 — the sources a person keeps
-- ============================================================================
-- Trust reads what kind of source each of a page's links is: primary
-- (official, research, standards), secondary, weak (forums, social posts) or
-- a competitor's page. A weak source or a competitor's the person trusts all
-- the same is kept: it no longer lowers Trust or shows as a suggestion. Kept
-- per draft, by the link's address as the page has it, 50 at most.

alter table public.content_drafts
  add column if not exists kept_sources text[] not null default '{}'
    check (cardinality(kept_sources) <= 50);

comment on column public.content_drafts.kept_sources is
  'Quality CE-046 (00263): weak or competitors'' sources the person chose to keep on this page, by address. They don''t lower Trust.';

-- Keeps one source on a draft, once, up to the 50: a member's own change of
-- their draft, through their policy (security invoker). Returns the draft's
-- kept sources after, or nothing when the caller can't change the draft.
create or replace function public.content_draft_keep_source(p_draft_id uuid, p_url text)
returns text[]
language sql
volatile
security invoker
set search_path = public
as $$
  update public.content_drafts
  set kept_sources = case
    when p_url = any (kept_sources) or cardinality(kept_sources) >= 50 then kept_sources
    else array_append(kept_sources, p_url)
  end
  where id = p_draft_id
    and char_length(p_url) between 1 and 2048
  returning kept_sources;
$$;

revoke execute on function public.content_draft_keep_source(uuid, text) from public, anon;
grant execute on function public.content_draft_keep_source(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';
