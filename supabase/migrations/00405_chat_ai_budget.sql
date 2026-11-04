-- ============================================================================
-- 00405: Chat's model steps on the workspace's one AI budget
-- ============================================================================
-- Chat (CHAT-04 §C items 11–14, CHAT-16 items 22, 26, 28–30; DECISIONS P),
-- behind CHAT_AGENTIC: with the flag on, a Chat run calls models on
-- GetCito's key and each model step draws on the workspace's monthly AI
-- budget (plan.limits.improveMonthlyBudgetUsd), the one Improve, the Content
-- Editor's AI and the Action Center's task writer already share
-- (prompt_improve_usage, 00120 / 00242 / 00243). A step costs what the model
-- costs (1x); the margin on purchased AI credits (CHAT-16 30a) is not here.
--
--   * feature: 'chat' (a Chat run's model step), and the room the next ones
--     need: 'agent' (CHAT-21), 'schedule' (CHAT-12) and 'image' (CHAT-15).
--   * own_key: the step ran on the workspace's own provider key (CHAT-16
--     item 26). Its row is written, with its cost, so every step has one,
--     but the provider bills the workspace: it never counts toward the
--     budget. Every sum of the budget leaves it out (the two functions
--     below, and the server's reads in planGuard.js).
--   * chat_run_id, chat_run_step_id: the run, and the step when it has one,
--     the row was for (00400). A deleted run or step leaves its rows, named
--     by neither: what was spent stays spent.
--   * reserve_chat_ai_usage: a step's hold before it starts. Stricter than
--     reserve_ai_usage (00243), which lets a call start while anything is
--     left: a Chat step starts only when the period's spend, holds in flight
--     included, plus the step's worst case stays within the budget (CHAT-04
--     item 13), so runs at once can't pass it. The same per-organization
--     lock as reserve_ai_usage, so Chat and the other features queue on one
--     budget.
--   * organizations.legacy_key_grandfathered: a Starter workspace (or one
--     in its free trial) that saved its own key before Chat drew on the
--     budget keeps using it (CHAT-16 item 28): own keys are otherwise
--     Growth's and Enterprise's. Set here for those with a key now; the web
--     sets it for one that saves a key while Chat is still off for it. Only
--     the server writes it (the guard below).

-- ─── What a row was for ─────────────────────────────────────────────────────

alter table public.prompt_improve_usage
  drop constraint if exists prompt_improve_usage_feature_check;
alter table public.prompt_improve_usage
  add constraint prompt_improve_usage_feature_check
    check (
      feature is null
      or feature in (
        'improve', 'content', 'action_center', 'quality', 'chat', 'agent', 'schedule', 'image'
      )
    );

comment on column public.prompt_improve_usage.feature is
  'What the AI call was for: improve (the Improve tab), content (the Content Editor''s AI), action_center (the task writer), quality (the Content Editor''s Quality checks, 00264), chat (a Chat run''s model step, 00405), agent, schedule or image (Chat''s agents, scheduled runs and images). Null on rows from before 00242 whose prompt, draft or action was deleted.';

alter table public.prompt_improve_usage
  add column if not exists own_key boolean not null default false;

comment on column public.prompt_improve_usage.own_key is
  'The call ran on the workspace''s own provider key (CHAT-16 item 26): the provider bills the workspace, so the row never counts toward the AI budget.';

alter table public.prompt_improve_usage
  add column if not exists chat_run_id uuid
    references public.chat_runs(id) on delete set null;
alter table public.prompt_improve_usage
  add column if not exists chat_run_step_id uuid
    references public.chat_run_steps(id) on delete set null;

comment on column public.prompt_improve_usage.chat_run_id is
  'The Chat run whose model step this row is (00405). Null for other features, and once the run is deleted.';
comment on column public.prompt_improve_usage.chat_run_step_id is
  'The run''s step the model call was for, when it had one. Null otherwise, and once the step is deleted.';

-- A run's rows, for its cost; and what a deleted run or step looks up.
create index if not exists prompt_improve_usage_chat_run_idx
  on public.prompt_improve_usage (chat_run_id)
  where chat_run_id is not null;
create index if not exists prompt_improve_usage_chat_run_step_idx
  on public.prompt_improve_usage (chat_run_step_id)
  where chat_run_step_id is not null;

-- ─── The budget's sums leave own-key rows out ───────────────────────────────

-- 00243's, with own-key rows left out of the spend.
create or replace function public.reserve_ai_usage(
  p_organization_id  uuid,
  p_since            timestamptz,
  p_budget           numeric,
  p_cost             numeric,
  p_feature          text,
  p_model            text,
  p_prompt_id        uuid default null,
  p_action_id        uuid default null,
  p_content_draft_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_id    uuid;
begin
  -- One reservation at a time per organization: the next waits and sees this one.
  perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_organization_id::text));

  select coalesce(sum(cost_usd), 0) into v_spent
  from public.prompt_improve_usage
  where organization_id = p_organization_id
    and used_at >= p_since
    and not own_key;

  if v_spent >= p_budget then
    return null;
  end if;

  insert into public.prompt_improve_usage (
    organization_id, feature, model, prompt_id, action_id, content_draft_id, cost_usd)
  values (
    p_organization_id, p_feature, p_model, p_prompt_id, p_action_id, p_content_draft_id,
    greatest(p_cost, 0))
  returning id into v_id;
  return v_id;
end;
$$;

-- 00242's, with own-key rows left out: they never move the meter.
create or replace function public.ai_usage_by_feature(
  p_organization_id uuid,
  p_since timestamptz
)
returns table (feature text, cost_usd numeric)
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(u.feature, 'other') as feature, sum(u.cost_usd) as cost_usd
  from public.prompt_improve_usage u
  where u.organization_id = p_organization_id
    and u.used_at >= p_since
    and not u.own_key
  group by 1;
$$;

-- ─── A Chat step's hold ─────────────────────────────────────────────────────

-- Writes the step's row and returns its id; the server turns it into the
-- step's real cost once the model answers, or deletes it when nothing was
-- billed. Null when the budget can't cover the step's worst case (p_cost).
-- On the workspace's own key (p_own_key), or with no budget to hold against
-- (p_budget null: self-hosted), the row is written without a check. The run
-- must be the organization's, and the step, when named, the run's.
create or replace function public.reserve_chat_ai_usage(
  p_organization_id  uuid,
  p_chat_run_id      uuid,
  p_chat_run_step_id uuid,
  p_feature          text,
  p_model            text,
  p_cost             numeric,
  p_own_key          boolean,
  p_since            timestamptz,
  p_budget           numeric
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_spent numeric;
  v_id    uuid;
begin
  if p_feature is null or p_feature not in ('chat', 'agent', 'schedule', 'image') then
    raise exception 'not a Chat feature: %', p_feature using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.chat_runs r
    join public.chat_conversations c on c.id = r.conversation_id
    where r.id = p_chat_run_id
      and c.organization_id = p_organization_id
  ) or (
    p_chat_run_step_id is not null
    and not exists (
      select 1 from public.chat_run_steps s
      where s.id = p_chat_run_step_id and s.run_id = p_chat_run_id
    )
  ) then
    raise exception 'chat run not found' using errcode = 'P0002';
  end if;

  if not coalesce(p_own_key, false) and p_budget is not null then
    -- The lock reserve_ai_usage takes: one hold at a time per organization.
    perform pg_advisory_xact_lock(hashtext('ai_usage:' || p_organization_id::text));

    select coalesce(sum(cost_usd), 0) into v_spent
    from public.prompt_improve_usage
    where organization_id = p_organization_id
      and used_at >= p_since
      and not own_key;

    if v_spent >= p_budget or v_spent + greatest(p_cost, 0) > p_budget then
      return null;
    end if;
  end if;

  insert into public.prompt_improve_usage (
    organization_id, feature, model, cost_usd, own_key, chat_run_id, chat_run_step_id)
  values (
    p_organization_id, p_feature, p_model, greatest(p_cost, 0), coalesce(p_own_key, false),
    p_chat_run_id, p_chat_run_step_id)
  returning id into v_id;
  return v_id;
end;
$$;

comment on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric) is
  'Holds a Chat step''s worst-case cost (p_cost) on its organization''s AI budget under the per-organization lock, only while the period''s spend since p_since (own-key rows left out, holds in flight in) plus p_cost stays within p_budget; returns the row to settle, or null. Own-key steps and an unlimited budget (null) write the row unchecked.';

revoke all on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric)
  from public, anon, authenticated;
grant execute on function public.reserve_chat_ai_usage(uuid, uuid, uuid, text, text, numeric, boolean, timestamptz, numeric)
  to service_role;

-- ─── Starter keys saved before Chat drew on the budget ──────────────────────

alter table public.organizations
  add column if not exists legacy_key_grandfathered boolean not null default false;

comment on column public.organizations.legacy_key_grandfathered is
  'CHAT-16 item 28: a Starter workspace (or a Growth one in its free trial) that saved its own AI key before Chat drew on the AI budget keeps using that key for Chat. Set by 00405 and, while Chat is off for the workspace, when it saves a key; server only.';

update public.organizations o
set legacy_key_grandfathered = true
where (o.plan = 'starter' or (o.plan = 'growth' and o.subscription_status = 'trialing'))
  and exists (select 1 from public.organization_ai_keys k where k.organization_id = o.id);

-- 00276's guard, with the new column the server's too: a member can't mark
-- their own workspace.
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
  then
    raise exception 'organization column is managed server-side and cannot be set from the client'
      using errcode = '42501';
  end if;

  return new;
end;
$$;
