-- ============================================================================
-- 00446: notices when an agent goes live on its own, or stops being allowed to
-- ============================================================================
-- AUTONOMOUS-GO-LIVE §6.4, §7.2 (PR 8). Two new kinds of chat_notices (00441):
--
--   * agent_went_live: an agent an Admin allowed sent a page out on its own
--     (a CMS draft in v1). Its owner and the people its version notifies get
--     it at the top of their Inbox's Needs you, and an e-mail by their
--     "Notify me when an agent needs me". It names the agent, the page and
--     the CMS, so it carries the page's brand: brand_id.
--   * agent_go_live_off: an edit made a new version of an agent that was
--     allowed, so it no longer publishes on its own. The Admin who allowed it
--     and the owner are told, once per version.
--
-- A notice with a brand is read only by a person who reaches that brand
-- (user_brand_ids, 00388); one about the workspace (a key) has none. A
-- person closes their own notice once they open it (resolved_at), as they
-- mark it read (read_at). The server writes.

alter table public.chat_notices
  drop constraint if exists chat_notices_kind_check;
alter table public.chat_notices
  add constraint chat_notices_kind_check check (
    kind in (
      'own_key_failed',
      'own_key_limit_80',
      'own_key_limit_100',
      'agent_went_live',
      'agent_go_live_off'
    )
  );

alter table public.chat_notices
  add column if not exists brand_id uuid references public.brands(id) on delete cascade;

create index if not exists chat_notices_brand_idx
  on public.chat_notices (brand_id)
  where brand_id is not null;

comment on column public.chat_notices.brand_id is
  'The brand a notice is about (00446: a page an agent sent on its own); null for one about the workspace. Read only by people who reach the brand.';

comment on table public.chat_notices is
  'Chat (00441, 00446): a note from the system to a person: their own AI key failed or reached its agents'' monthly limit, an agent went live on its own, or an agent is no longer allowed to. Theirs to read, mark read and close; the server writes.';

-- A person closes their own notice once they open it.
grant update (resolved_at) on table public.chat_notices to authenticated;

-- Their own notices, and only about brands they reach.
drop policy if exists "chat_notices: own select" on public.chat_notices;
create policy "chat_notices: own select"
  on public.chat_notices
  for select
  to authenticated
  using (
    user_id = auth.uid()
    and organization_id in (
      select p.organization_id from public.profiles p where p.id = auth.uid()
    )
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

-- They mark read or close only notices they can read.
drop policy if exists "chat_notices: own read" on public.chat_notices;
create policy "chat_notices: own read"
  on public.chat_notices
  for update
  to authenticated
  using (
    user_id = auth.uid()
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  )
  with check (
    user_id = auth.uid()
    and (brand_id is null or brand_id in (select public.user_brand_ids()))
  );

notify pgrst, 'reload schema';
