-- ============================================================================
-- 00386: whether an organization's plan ends at the end of its period
-- ============================================================================
-- A canceled subscription runs to the end of its paid period (Stripe's
-- cancel_at_period_end). Billing read that live from Stripe; every page now
-- shows a thin band while it is so ("Your plan ends on {date} · Keep my
-- plan"), so the organization keeps it beside subscription_ends_at, written
-- as the plan is: by Stripe's webhook and the billing routes, with the
-- service role.
--
-- The column is the server's, as 00062 / 00276 / 00405's guard has the plan
-- and billing columns. Its own trigger holds it: 00405 rewrote that guard
-- after this number in the migration order, so a fresh install would end on
-- 00405's version, without this column.

alter table public.organizations
  add column if not exists cancel_at_period_end boolean not null default false;

comment on column public.organizations.cancel_at_period_end is
  'The subscription ends at the end of its period (canceled, still paid until subscription_ends_at): Stripe''s cancel_at_period_end, written by the webhook and the billing routes; server only.';

create or replace function public.guard_organization_cancel_at_period_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user) then
    return new;
  end if;

  if (tg_op = 'INSERT' and new.cancel_at_period_end is distinct from false)
     or (tg_op = 'UPDATE' and new.cancel_at_period_end is distinct from old.cancel_at_period_end)
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists organizations_guard_cancel_at_period_end on public.organizations;

create trigger organizations_guard_cancel_at_period_end
  before insert or update on public.organizations
  for each row
  execute function public.guard_organization_cancel_at_period_end();
