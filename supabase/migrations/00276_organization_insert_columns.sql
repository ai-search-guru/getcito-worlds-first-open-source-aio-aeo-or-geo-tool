-- ============================================================================
-- 00276: a new organization's plan and billing are set by the server
-- ============================================================================
-- An organization's plan, billing state and AI key columns belong to the
-- server: Stripe's webhook, the billing routes and the key settings write them
-- with the service role (00062). Onboarding creates the organization with the
-- person's own session, and sends only its name and slug; every other column
-- starts at its default.
--
-- 00062's guard compares the new row with the old one, so it ran on update
-- only. On insert there is no old row: the columns are held to their defaults
-- instead. A role that bypasses row-level security (the service role,
-- migrations) still sets them, as before.

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
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_guard_server_columns on public.organizations;

create trigger organizations_guard_server_columns
  before insert or update on public.organizations
  for each row
  execute function public.guard_organization_server_columns();
