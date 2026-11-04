-- ============================================================================
-- 00217: an agent's suggestions on a draft, for review in the editor
-- ============================================================================
-- Agent suggestions (Content Editor spec v2 §8, CE-018): an agent leaves
-- changes on a draft for a person to accept or reject, each with who made it
-- and why. They sit in the page as cards; accepting one changes the page,
-- and Undo, Restore and Undo all bring it back to review.
--
-- A suggestion is one of two kinds:
--   * replace: in the passage whose text is block_text, before_text becomes
--     after_text (plain text);
--   * insert: after the passage whose text is block_text, the blocks in
--     after_text (HTML, checked against the draft allow-list where it is
--     inserted) are added.
-- One agent run is a batch; the editor shows the latest. action_id names the
-- Action Center action the run came from ("from Action AC-214").
--
-- Agents write suggestions through the server (service role, CE-018 part D
-- and CE-022). Members read them, and decide them only through
-- content_draft_decide_suggestions, which records who decided and when.
create table if not exists public.content_draft_suggestions (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  batch_id uuid not null,
  action_id uuid references public.actions(id) on delete set null,
  agent text not null default 'content_agent' check (agent in ('content_agent')),
  kind text not null check (kind in ('replace', 'insert')),
  block_text text not null check (char_length(block_text) between 1 and 5000),
  before_text text not null default '' check (char_length(before_text) <= 5000),
  after_text text not null check (char_length(after_text) between 1 and 20000),
  reason text not null check (char_length(reason) between 1 and 300),
  rule_keys text[] not null default '{}',
  position integer not null default 0,
  status text not null default 'open' check (status in ('open', 'accepted', 'rejected')),
  decided_by uuid references public.profiles(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- A replacement names the words it replaces.
  check (kind = 'insert' or before_text <> '')
);

create index if not exists content_draft_suggestions_draft_idx
  on public.content_draft_suggestions (draft_id, created_at desc);

alter table public.content_draft_suggestions enable row level security;

-- A draft the member can read is one in their organization (content_drafts'
-- own member policies), so its suggestions follow it.
create policy "content_draft_suggestions: member select"
  on public.content_draft_suggestions
  for select
  using (draft_id in (select d.id from public.content_drafts d));

grant select on public.content_draft_suggestions to authenticated;

comment on table public.content_draft_suggestions is
  'Content Editor (CE-018): an agent''s suggested changes on a draft — replace words in a passage, or insert blocks after one — open, accepted or rejected. Written by the server; decided through content_draft_decide_suggestions.';

-- Accepts, rejects, or sends back to review (open) the given suggestions of
-- drafts the caller may change, recording who decided and when. Returns how
-- many changed.
create or replace function public.content_draft_decide_suggestions(
  p_ids uuid[],
  p_status text
)
returns integer
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  if p_status is null or p_status not in ('open', 'accepted', 'rejected') then
    raise exception 'content_draft_decide_suggestions: unknown status %', p_status
      using errcode = '22023';
  end if;
  if p_ids is null or cardinality(p_ids) = 0 then
    return 0;
  end if;
  if cardinality(p_ids) > 200 then
    raise exception 'content_draft_decide_suggestions: at most 200 at once' using errcode = '22023';
  end if;

  update public.content_draft_suggestions s
  set status = p_status,
      decided_by = case when p_status = 'open' then null else auth.uid() end,
      decided_at = case when p_status = 'open' then null else now() end
  where s.id = any(p_ids)
    and public.content_draft_member(s.draft_id);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.content_draft_decide_suggestions(uuid[], text) from public, anon;
grant execute on function public.content_draft_decide_suggestions(uuid[], text)
  to authenticated, service_role;
