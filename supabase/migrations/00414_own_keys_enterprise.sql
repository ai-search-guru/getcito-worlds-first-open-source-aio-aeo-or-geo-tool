-- ============================================================================
-- 00414: own AI keys are Enterprise's; a key saved before Chat keeps 30 days
-- ============================================================================
-- Owner decision 2026-10-30 (CHAT-16 items 19 and 28): with Chat on for a
-- workspace (CHAT_AGENTIC), it runs on its own provider key only on
-- Enterprise. On Growth own keys would take the place of AI credit packs.
-- A workspace that saved a key before Chat went live for it keeps using
-- that key for 30 days, on any plan; after that Chat runs on the plan's
-- monthly AI limit.
--
--   * legacy_key_grandfathered (00405) now marks every workspace that isn't
--     on Enterprise and has a saved key: 00405 marked only Starter and
--     Growth trials, while paid Growth had own keys in its plan. The web
--     marks one that saves a key while Chat is still off for it, as before.
--   * legacy_key_until: when its 30 days end. Empty until Chat (or Settings
--     › AI Providers) first needs the key with Chat on; the web fills it
--     once (lib/chat/key.ts startLegacyKeyDays). Server only, as the mark.

alter table public.organizations
  add column if not exists legacy_key_until timestamptz;

comment on column public.organizations.legacy_key_grandfathered is
  'CHAT-16 item 28: a workspace not on Enterprise that saved its own AI key before Chat went live for it keeps using that key for Chat for 30 days (legacy_key_until). Set by 00405 / 00414 and, while Chat is off for the workspace, when it saves a key; server only.';

comment on column public.organizations.legacy_key_until is
  'CHAT-16 item 28: when a kept key (legacy_key_grandfathered) stops running Chat, 30 days after Chat first needed it. Null until then; server only.';

update public.organizations o
set legacy_key_grandfathered = true
where o.plan is distinct from 'enterprise'
  and not o.legacy_key_grandfathered
  and exists (select 1 from public.organization_ai_keys k where k.organization_id = o.id);

-- 00405's guard, with the new column the server's too: a member can't move
-- their own workspace's end date.
create or replace function public.guard_organization_server_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.plan is distinct from 'free'
       or new.plan_overrides is not null
       or new.subscription_status is distinct from 'incomplete'
       or new.subscription_ends_at is not null
       or new.stripe_customer_id is not null
       or new.stripe_subscription_id is not null
       or new.anthropic_api_key_encrypted is not null
       or new.anthropic_api_key_last4 is not null
       or new.anthropic_api_key_set_at is not null
       or new.anthropic_api_key_set_by is not null
       or new.legacy_key_grandfathered is distinct from false
       or new.legacy_key_until is not null
    then
      raise exception 'organization column is managed server-side and cannot be set from the client'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.plan is distinct from old.plan
     or new.plan_overrides is distinct from old.plan_overrides
     or new.subscription_status is distinct from old.subscription_status
     or new.subscription_ends_at is distinct from old.subscription_ends_at
     or new.stripe_customer_id is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.anthropic_api_key_encrypted is distinct from old.anthropic_api_key_encrypted
     or new.anthropic_api_key_last4 is distinct from old.anthropic_api_key_last4
     or new.anthropic_api_key_set_at is distinct from old.anthropic_api_key_set_at
     or new.anthropic_api_key_set_by is distinct from old.anthropic_api_key_set_by
     or new.legacy_key_grandfathered is distinct from old.legacy_key_grandfathered
     or new.legacy_key_until is distinct from old.legacy_key_until
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
