-- ============================================================================
-- 00214: a workspace's own rules per page type (Content Editor, CE-009)
-- ============================================================================
-- The Rules tab's "Save as my rules" (Content Editor spec v2 §10) keeps a
-- draft's rule choices for the workspace, per page type: the values and
-- switches the person changed, and the rules they wrote in their own words.
-- A new draft of that type starts from them ("My rules"); Reset takes a
-- draft back to GetCito's default set. The rules themselves are the app's
-- (frontend/src/lib/content/rules.ts); a set keeps only what differs.
--
--   * content_rule_sets: one row per organization and page type, with
--     overrides {key: {on, value}} and text_rules [{id, text, on}] — the
--     same shapes as content_drafts.rules (00213). Pasted rule text is
--     writing guidance for the editor and the agent only; it changes no
--     access or safety rule (spec §10, CHAT-05).
--   * Members of the organization read them; admins and managers save them,
--     as they do the workspace's other settings (brand_domains), since every
--     new draft of the type starts from them.

create table if not exists public.content_rule_sets (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  page_type text not null check (char_length(page_type) between 1 and 40),
  overrides jsonb not null default '{}'::jsonb
    check (jsonb_typeof(overrides) = 'object' and octet_length(overrides::text) <= 16384),
  text_rules jsonb not null default '[]'::jsonb
    check (jsonb_typeof(text_rules) = 'array' and jsonb_array_length(text_rules) <= 50
      and octet_length(text_rules::text) <= 32768),
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (organization_id, page_type)
);

alter table public.content_rule_sets enable row level security;

create policy "content_rule_sets: member select"
  on public.content_rule_sets
  for select
  using (organization_id in (select p.organization_id from public.profiles p where p.id = auth.uid()));

create policy "content_rule_sets: manager insert"
  on public.content_rule_sets
  for insert
  with check (
    organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and updated_by = auth.uid()
  );

create policy "content_rule_sets: manager update"
  on public.content_rule_sets
  for update
  using (
    organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
  )
  with check (
    organization_id in (
      select p.organization_id from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'manager')
    )
    and updated_by = auth.uid()
  );

grant select, insert, update on public.content_rule_sets to authenticated;

comment on table public.content_rule_sets is
  'Content Editor (CE-009): a workspace''s "My rules" per page type — rule overrides and text rules a new draft of the type starts from.';
