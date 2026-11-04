-- ============================================================================
-- 00442: a monthly limit for all agents on the workspace's own AI key
-- ============================================================================
-- AGENT-OWN-KEY §4.2, §6.3. On the workspace's own key each agent run has
-- its cap, but nothing bounded what all agents together spend on the key in
-- a month. The key guard does:
--
--   * chat_settings.own_key_agent_month_usd: the most all agents' runs may
--     spend on the workspace's own key in the AI period (the meter's, so it
--     renews with it). $250 unless an Admin set it, $10–$10,000, always on
--     (owner decision D5, 2026-11-01). No chat_settings row reads as $250.
--   * chat_own_key_agent_spend: what the agents' own-key steps cost since a
--     moment, at the price each step was charged (prompt_improve_usage rows
--     with own_key and feature agent or schedule; holds in flight count at
--     their worst case). The server's guard reads it (lib/chatBudget.js);
--     the dollars stay on the server but for the Admins' settings card.
--   * chat_agents.paused_reason gains own_key_cap: the guard was reached; the
--     agent starts again by itself once the period renews or an Admin raises
--     the guard.
--
-- Constraint swaps on small tables: no rewrite, existing rows already pass.

alter table public.chat_settings
  add column if not exists own_key_agent_month_usd numeric(10, 2) not null default 250
    check (own_key_agent_month_usd between 10 and 10000);

comment on column public.chat_settings.own_key_agent_month_usd is
  'The most all agents may spend on the workspace''s own AI key in the AI period, in dollars at list prices ($10–$10,000; always on).';

alter table public.chat_agents
  drop constraint if exists chat_agents_paused_reason_check;

alter table public.chat_agents
  add constraint chat_agents_paused_reason_check check (
    paused_reason in (
      'cap',
      'connection',
      'skill_off',
      'failures',
      'owner_role',
      'plan',
      'brand_gone',
      'manual',
      'own_key',
      'own_key_cap'
    )
  );

-- What the workspace's agents spent on its own key since p_since, in dollars.
create or replace function public.chat_own_key_agent_spend(
  p_organization_id uuid,
  p_since timestamptz
)
returns numeric
language sql
stable
set search_path = public
as $$
  select coalesce(sum(cost_usd), 0)
  from prompt_improve_usage
  where organization_id = p_organization_id
    and own_key
    and feature in ('agent', 'schedule')
    and used_at >= p_since;
$$;

revoke all on function public.chat_own_key_agent_spend(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.chat_own_key_agent_spend(uuid, timestamptz) to service_role;

notify pgrst, 'reload schema';
