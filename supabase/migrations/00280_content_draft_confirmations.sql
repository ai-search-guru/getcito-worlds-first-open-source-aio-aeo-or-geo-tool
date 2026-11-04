-- ============================================================================
-- 00280: Quality phase 3, CE-052 — what only the person can confirm
-- ============================================================================
-- What Quality can't verify on its own becomes a confirm step, never a pass
-- (Content Editor Quality spec §11): a customer's case (their name, logo or
-- results) goes out only with their permission, and only the person knows
-- they have it. Their statement is kept here, with who made it, by what it
-- is about: its kind, and its key (a customer case's, by its claim's words;
-- the page matches a case to it by those words). Category pages' intro
-- facts (CE-054) are confirmed here too.

create table if not exists public.content_draft_confirmations (
  draft_id uuid not null references public.content_drafts(id) on delete cascade,
  kind text not null check (kind in ('customer_case', 'intro_fact')),
  key text not null check (char_length(key) between 1 and 400),
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz not null default now(),
  primary key (draft_id, kind, key)
);

alter table public.content_draft_confirmations enable row level security;
revoke all on table public.content_draft_confirmations from anon, authenticated;
grant select, insert on table public.content_draft_confirmations to authenticated;
grant all on table public.content_draft_confirmations to service_role;

comment on table public.content_draft_confirmations is
  'Quality CE-052 (00280): what a member confirmed that only they can (a customer case may be published; a category intro''s facts are right), by kind and key, with who and when. Members read their drafts'' and confirm as themselves; no update or delete.';

drop policy if exists "content_draft_confirmations: member select" on public.content_draft_confirmations;
create policy "content_draft_confirmations: member select"
  on public.content_draft_confirmations
  for select
  using (public.content_draft_member(draft_id));

-- A member confirms as themself, now.
drop policy if exists "content_draft_confirmations: member insert" on public.content_draft_confirmations;
create policy "content_draft_confirmations: member insert"
  on public.content_draft_confirmations
  for insert
  with check (
    public.content_draft_member(draft_id)
    and confirmed_by = auth.uid()
    and confirmed_at between now() - interval '1 minute' and now() + interval '1 minute'
  );

create or replace function public.content_draft_confirmations_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- One confirm at a time a draft, so the count holds.
  perform pg_advisory_xact_lock(hashtext('content_draft_confirmations'), hashtext(new.draft_id::text));
  -- Confirmed already: the insert's ON CONFLICT leaves it as it is.
  if exists (
    select 1 from public.content_draft_confirmations
    where draft_id = new.draft_id and kind = new.kind and key = new.key
  ) then
    return new;
  end if;
  if (select count(*) from public.content_draft_confirmations where draft_id = new.draft_id) >= 50 then
    raise exception 'A draft keeps 50 confirmations at most' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists content_draft_confirmations_cap on public.content_draft_confirmations;
create trigger content_draft_confirmations_cap
  before insert on public.content_draft_confirmations
  for each row execute function public.content_draft_confirmations_cap();

notify pgrst, 'reload schema';
