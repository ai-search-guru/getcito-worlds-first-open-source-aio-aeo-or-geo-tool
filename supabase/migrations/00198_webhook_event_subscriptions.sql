-- ============================================================================
-- 00198: per-webhook event subscriptions
-- ============================================================================
-- Keep existing integrations receiving the events they already receive. Event
-- subscription controls are now available in Content → Configure Webhook.
-- Test deliveries use webhook.test directly and are not stored subscriptions.

alter table public.webhook_configs
  alter column events set default
    array['opportunity.sent', 'daily_pulse.created', 'action_task.sent']::text[];

update public.webhook_configs as config
set events = (
  select array_agg(subscription.event order by subscription.event)
  from (
    select distinct event
    from unnest(
      coalesce(config.events, array[]::text[])
      || array['opportunity.sent', 'daily_pulse.created', 'action_task.sent']::text[]
    ) as existing(event)
    where event = any(array['opportunity.sent', 'daily_pulse.created', 'action_task.sent']::text[])
  ) as subscription
);

alter table public.webhook_configs
  alter column events set not null;

alter table public.webhook_configs
  drop constraint if exists webhook_configs_events_allowed;

alter table public.webhook_configs
  add constraint webhook_configs_events_allowed
  check (events <@ array['opportunity.sent', 'daily_pulse.created', 'action_task.sent']::text[]);

comment on column public.webhook_configs.events is
  'Event types subscribed to by this webhook (opportunity.sent, daily_pulse.created, action_task.sent). webhook.test is always sent by the test action and is not stored here.';

notify pgrst, 'reload schema';
