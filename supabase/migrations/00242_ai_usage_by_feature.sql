-- What each AI usage row was for, and the period's spend by feature, for the
-- Billing page's "This period's AI usage" meter.
--
-- prompt_improve_usage (00120) is the workspace's one AI budget
-- (plan.limits.improveMonthlyBudgetUsd): Improve suggestions, the Content
-- Editor's AI (briefs, the Content Agent, Start Agent) and the Action
-- Center's task writer all charge it. A row named what it was for only
-- through prompt_id / action_id (00150) / content_draft_id (00212), each set
-- null when its prompt, action or draft is deleted; feature keeps it.

alter table public.prompt_improve_usage
  add column if not exists feature text
    constraint prompt_improve_usage_feature_check
      check (feature is null or feature in ('improve', 'content', 'action_center'));

comment on column public.prompt_improve_usage.feature is
  'What the AI call was for: improve (the Improve tab), content (the Content Editor''s AI) or action_center (the task writer). Null on rows from before 00242 whose prompt, draft or action was deleted.';

-- Rows from before: read from the item each still names.
update public.prompt_improve_usage
set feature = case
    when action_id is not null then 'action_center'
    when content_draft_id is not null then 'content'
    when prompt_id is not null then 'improve'
  end
where feature is null
  and (action_id is not null or content_draft_id is not null or prompt_id is not null);

-- The organization's spend since p_since (its quota period's start), by
-- feature; rows with none come back as 'other'. Summed in the database: the
-- meter reads every row of the period, however many.
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
  group by 1;
$$;

comment on function public.ai_usage_by_feature(uuid, timestamptz) is
  'An organization''s AI spend since p_since by prompt_improve_usage.feature (''other'' when unknown), for the Billing page''s AI usage meter (getAiUsage).';

revoke all on function public.ai_usage_by_feature(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.ai_usage_by_feature(uuid, timestamptz) to service_role;
