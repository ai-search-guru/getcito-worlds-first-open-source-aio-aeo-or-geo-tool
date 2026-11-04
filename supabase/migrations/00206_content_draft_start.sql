-- ============================================================================
-- 00206: what a draft was started for (Content Editor, CE-003 / CE-015)
-- ============================================================================
-- New content starts a draft from an opportunity, a tracked prompt or a
-- topic, or from content to optimize (Content Editor spec v2 §5, §9). The
-- draft keeps what it is for:
--
--   * opportunity_id: the Content Opportunity it was started from, if any.
--   * prompt_ids: the tracked prompts the page should answer: the
--     opportunity's, the one prompt picked, or a topic's active prompts. The
--     overlap check, Impact and the brief read them.
--
-- Both must belong to the draft's brand: a check trigger turns away another
-- brand's opportunity or prompts, which the foreign key alone would accept.
-- It checks only the prompt ids a write adds, and a deleted prompt leaves
-- every draft's prompt_ids (it has no foreign key to do that), so a draft
-- that had one can still take more.

alter table public.content_drafts
  add column if not exists opportunity_id uuid
    references public.content_opportunities(id) on delete set null,
  add column if not exists prompt_ids uuid[] not null default '{}'
    check (cardinality(prompt_ids) <= 500);

comment on column public.content_drafts.opportunity_id is
  'Content Editor (CE-003): the Content Opportunity the draft was started from.';
comment on column public.content_drafts.prompt_ids is
  'Content Editor (CE-003): the tracked prompts the page should answer.';

create index if not exists content_drafts_opportunity_idx
  on public.content_drafts (opportunity_id)
  where opportunity_id is not null;

-- Runs as the writer: a member sees only their organization's opportunities
-- and prompts, so another brand's ids read as missing and are refused.
create or replace function public.check_content_draft_links()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.opportunity_id is not null
     and (tg_op = 'INSERT' or new.opportunity_id is distinct from old.opportunity_id)
     and not exists (
       select 1
       from public.content_opportunities o
       where o.id = new.opportunity_id and o.brand_id = new.brand_id
     )
  then
    raise exception 'content draft opportunity belongs to another brand'
      using errcode = '23514';
  end if;

  if cardinality(new.prompt_ids) > 0
     and (tg_op = 'INSERT' or new.prompt_ids is distinct from old.prompt_ids)
     and exists (
       select 1
       from unnest(new.prompt_ids) as wanted(id)
       -- Only what this write adds: the ids already there were checked.
       where wanted.id <> all(case when tg_op = 'UPDATE' then old.prompt_ids else '{}' end)
         and not exists (
           select 1
           from public.prompts p
           join public.prompt_sets s on s.id = p.prompt_set_id
           where p.id = wanted.id and s.brand_id = new.brand_id
         )
     )
  then
    raise exception 'content draft prompt belongs to another brand'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace trigger content_drafts_check_links
  before insert or update on public.content_drafts
  for each row execute function public.check_content_draft_links();

-- A deleted prompt leaves the drafts that had it, in one update per delete
-- statement (a topic's prompts go together). Definer: the drafts may be ones
-- the deleting member can't write, and the deletion is theirs to make.
create or replace function public.forget_deleted_draft_prompts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gone uuid[];
begin
  select coalesce(array_agg(id), '{}') into v_gone from deleted_prompts;
  update public.content_drafts d
  set prompt_ids = array(select x from unnest(d.prompt_ids) as x where x <> all(v_gone))
  where d.prompt_ids && v_gone;
  return null;
end;
$$;

revoke execute on function public.forget_deleted_draft_prompts() from public, anon, authenticated;

create or replace trigger prompts_forget_in_content_drafts
  after delete on public.prompts
  referencing old table as deleted_prompts
  for each statement execute function public.forget_deleted_draft_prompts();
