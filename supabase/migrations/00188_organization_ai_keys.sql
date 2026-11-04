-- AI Providers (Settings): an organization's own keys for Chat, one per
-- provider — Anthropic, OpenAI, Google Gemini, Microsoft Azure OpenAI and
-- OpenRouter — and which one Chat uses (`active`, at most one per org).
--
-- Each key is the AES-256-GCM envelope from frontend/src/lib/agent/keyEncryption.ts,
-- as the Anthropic key on `organizations` was (00010); `last4` is display-only.
-- `settings` holds what a provider needs besides the key: Azure's endpoint
-- and deployment, OpenRouter's model.
--
-- RLS on with no policies: only the service role reads and writes it (the web
-- app's /api/settings/ai-providers route and Chat).

create table public.organization_ai_keys (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null
    check (provider in ('anthropic', 'openai', 'google', 'azure', 'openrouter')),
  key_encrypted text not null,
  key_last4 text not null,
  settings jsonb not null default '{}'::jsonb,
  active boolean not null default false,
  set_at timestamptz not null default now(),
  set_by uuid references public.profiles(id) on delete set null,
  primary key (organization_id, provider)
);

create unique index organization_ai_keys_one_active
  on public.organization_ai_keys (organization_id)
  where active;

alter table public.organization_ai_keys enable row level security;

comment on table public.organization_ai_keys is
  'Organization-level AI provider keys for Chat (BYOK, cloud). Service role only.';
comment on column public.organization_ai_keys.active is
  'The provider Chat uses; at most one per organization.';

-- Existing Anthropic keys carry over as the provider Chat uses. The old
-- organizations.anthropic_api_key_* columns stay until a later migration.
insert into public.organization_ai_keys
  (organization_id, provider, key_encrypted, key_last4, active, set_at, set_by)
select id, 'anthropic', anthropic_api_key_encrypted, coalesce(anthropic_api_key_last4, ''),
       true, coalesce(anthropic_api_key_set_at, now()), anthropic_api_key_set_by
from public.organizations
where anthropic_api_key_encrypted is not null
on conflict (organization_id, provider) do nothing;

-- Makes one saved provider the one Chat uses; with p_only_if_none, only when
-- none is yet (a first key saved). The organization's rows are locked first,
-- so two switches at once queue rather than both setting `active` and one
-- failing the unique index. Others off first: that index is checked row by
-- row. False when the organization has no key for that provider.
create or replace function public.set_active_ai_provider(
  p_organization_id uuid,
  p_provider text,
  p_only_if_none boolean default false
) returns boolean
language plpgsql
set search_path = public
as $$
begin
  perform 1 from organization_ai_keys
  where organization_id = p_organization_id
  for update;

  if not exists (
    select 1 from organization_ai_keys
    where organization_id = p_organization_id and provider = p_provider
  ) then
    return false;
  end if;
  if p_only_if_none and exists (
    select 1 from organization_ai_keys
    where organization_id = p_organization_id and active
  ) then
    return true;
  end if;
  update organization_ai_keys set active = false
  where organization_id = p_organization_id and active and provider <> p_provider;
  update organization_ai_keys set active = true
  where organization_id = p_organization_id and provider = p_provider and not active;
  return true;
end;
$$;

revoke execute on function public.set_active_ai_provider(uuid, text, boolean)
  from public, anon, authenticated;
grant execute on function public.set_active_ai_provider(uuid, text, boolean)
  to service_role;

-- Removes a provider's key. When it was the one Chat used, the most recently
-- saved other key takes over, in the same transaction and under the same
-- lock as a switch. Returns the provider Chat uses afterwards, or null.
create or replace function public.remove_ai_provider_key(
  p_organization_id uuid,
  p_provider text
) returns text
language plpgsql
set search_path = public
as $$
declare
  v_was_active boolean;
  v_next text;
begin
  perform 1 from organization_ai_keys
  where organization_id = p_organization_id
  for update;

  delete from organization_ai_keys
  where organization_id = p_organization_id and provider = p_provider
  returning active into v_was_active;

  if coalesce(v_was_active, false) then
    select provider into v_next
    from organization_ai_keys
    where organization_id = p_organization_id
    order by set_at desc
    limit 1;
    if v_next is not null then
      update organization_ai_keys set active = true
      where organization_id = p_organization_id and provider = v_next;
    end if;
    return v_next;
  end if;

  select provider into v_next
  from organization_ai_keys
  where organization_id = p_organization_id and active;
  return v_next;
end;
$$;

revoke execute on function public.remove_ai_provider_key(uuid, text)
  from public, anon, authenticated;
grant execute on function public.remove_ai_provider_key(uuid, text)
  to service_role;

notify pgrst, 'reload schema';
