-- ============================================================================
-- 00265: Quality phase 2, CE-048 — Brief › Your input
-- ============================================================================
-- What only the person can give a page, kept beside its brief (a rebuild
-- writes the brief over; this stays): their first-hand experience, their
-- data (rows read from a CSV or Excel file in the browser, or pasted, and
-- GetCito data they chose to use) and expert quotes, each with the
-- person's name, title, the words as said and where they were said. The
-- Content Agent writes from them as given and adds nothing beyond them;
-- E-E-A-T and Trust count them once the page uses them.
--
-- One row a draft, read and written by the members of its workspace
-- (content_draft_member, 00215), as the draft itself is; a write names its
-- writer as updated_by, as content_rule_sets' do (00214). The sizes match
-- what the editor keeps (frontend/src/lib/content/draftInputs.ts).

create table if not exists public.content_draft_inputs (
  draft_id uuid primary key references public.content_drafts(id) on delete cascade,
  experience text check (experience is null or char_length(experience) <= 4000),
  -- [{ "name": "…", "rows": [["…"]] }]: the tables as read, 5 at most.
  data jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(data) = 'array'
      and jsonb_array_length(data) <= 5
      and octet_length(data::text) <= 65536
    ),
  -- [{ "promptId", "prompt", "answers", "mentioned", "asOf", "days" }]: GetCito data used, with the day it was used and the days it covers.
  getcito_data jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(getcito_data) = 'array'
      and jsonb_array_length(getcito_data) <= 10
      and octet_length(getcito_data::text) <= 16384
    ),
  -- [{ "name", "title", "text", "sourceUrl" }]: quotes from real people, word for word.
  quotes jsonb not null default '[]'::jsonb
    check (
      jsonb_typeof(quotes) = 'array'
      and jsonb_array_length(quotes) <= 10
      and octet_length(quotes::text) <= 16384
    ),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create or replace trigger content_draft_inputs_updated_at
  before update on public.content_draft_inputs
  for each row execute function public.handle_updated_at();

alter table public.content_draft_inputs enable row level security;
revoke all on table public.content_draft_inputs from anon;
grant select, insert, update, delete on table public.content_draft_inputs to authenticated;
grant all on table public.content_draft_inputs to service_role;

drop policy if exists "content_draft_inputs: member select" on public.content_draft_inputs;
create policy "content_draft_inputs: member select"
  on public.content_draft_inputs for select
  using (public.content_draft_member(draft_id));

drop policy if exists "content_draft_inputs: member insert" on public.content_draft_inputs;
create policy "content_draft_inputs: member insert"
  on public.content_draft_inputs for insert
  with check (public.content_draft_member(draft_id) and updated_by = auth.uid());

drop policy if exists "content_draft_inputs: member update" on public.content_draft_inputs;
create policy "content_draft_inputs: member update"
  on public.content_draft_inputs for update
  using (public.content_draft_member(draft_id))
  with check (public.content_draft_member(draft_id) and updated_by = auth.uid());

drop policy if exists "content_draft_inputs: member delete" on public.content_draft_inputs;
create policy "content_draft_inputs: member delete"
  on public.content_draft_inputs for delete
  using (public.content_draft_member(draft_id));

comment on table public.content_draft_inputs is
  'Quality CE-048 (00265): Brief › Your input — a draft''s first-hand experience, data and expert quotes, as the person gave them. The Content Agent writes from them and adds nothing beyond them.';

notify pgrst, 'reload schema';
