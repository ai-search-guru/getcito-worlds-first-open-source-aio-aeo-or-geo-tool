-- ============================================================================
-- 00367: how a brand decides the Content Agent's suggestions, by rule
-- (learning B6)
-- ============================================================================
-- Each suggestion the agent leaves on a draft (00217) names the rules it
-- fixes (rule_keys), and keeps whether a person accepted or rejected it. Read
-- one at a time, nothing learned from them. This sums a brand's decisions
-- since a day by rule: the agent keeps its changes small for a rule people
-- there mostly reject (contentSuggestionStats.js). One brand's own
-- decisions only, read by the API (service role).
--
-- Only its small changes count, a passage's words replaced or blocks
-- inserted: a whole page rewritten to the rules (kind 'page', 00247) names
-- every rule it was asked for, and one rejected would count against each.
-- `drafts` is how many drafts a rule's suggestions were rejected on, so one
-- Reject all on one draft isn't read as a habit, even beside an Accept on
-- another.

-- A database with an earlier shape of it (a dev database, before review)
-- takes this one in its place: create or replace can't change its rows.
drop function if exists public.content_suggestion_decisions(uuid, timestamptz);

create or replace function public.content_suggestion_decisions(
  p_brand_id uuid,
  p_since timestamptz
)
returns table (rule_key text, accepted integer, rejected integer, drafts integer)
language sql
stable
security invoker
set search_path to 'public'
as $$
  select k.rule_key,
         count(*) filter (where s.status = 'accepted')::integer as accepted,
         count(*) filter (where s.status = 'rejected')::integer as rejected,
         count(distinct s.draft_id) filter (where s.status = 'rejected')::integer as drafts
    from public.content_draft_suggestions s
    join public.content_drafts d on d.id = s.draft_id
    cross join lateral unnest(s.rule_keys) as k(rule_key)
   where d.brand_id = p_brand_id
     and s.kind in ('replace', 'insert')
     and s.status in ('accepted', 'rejected')
     and s.decided_at >= p_since
   group by k.rule_key;
$$;

revoke all on function public.content_suggestion_decisions(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.content_suggestion_decisions(uuid, timestamptz) to service_role;

comment on function public.content_suggestion_decisions(uuid, timestamptz) is
  'A brand''s accepted and rejected Content Agent suggestions since a day, by rule key, and the drafts they were rejected on; small changes only, not page rewrites (00367, learning B6). Service role only.';

notify pgrst, 'reload schema';
