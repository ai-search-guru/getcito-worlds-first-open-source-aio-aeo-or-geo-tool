-- An action's priority: how soon to work on it, beside the others (AC-006).
--
-- Impact (high / medium / low) says how much an action could matter; it was
-- also the only thing the Action Center sorted by, so a brand with eleven
-- high-impact actions had eleven "top" ones and no order among them. The
-- priority score answers the other question: what to do first. It is worked
-- out on the server from the action's evidence — impact, demand, severity,
-- business value, independent confirmation, recoverability and recency
-- (backend/src/lib/action-center/priority.js) — every night and when an action
-- is created, and stored here so the list, its sort, the Top Actions card,
-- the exports and the API all read one number.
--
--   priority_score       0–100.
--   priority_level       critical (90+), high (75–89), medium (50–74), low.
--   priority_reason      what the score rests on, as facts (severity, the
--                        subject and its count, demand, commercial intent,
--                        recency…) from which the app writes "Why this
--                        priority?" in the reader's language.
--   priority_updated_at  when it was last worked out.
--
-- Null until the first scoring: the app falls back to ordering by impact.

alter table public.actions
  add column if not exists priority_score smallint
    check (priority_score between 0 and 100),
  add column if not exists priority_level text
    check (priority_level in ('critical', 'high', 'medium', 'low')),
  add column if not exists priority_reason jsonb,
  add column if not exists priority_updated_at timestamptz;

-- The list and the Top Actions card read a brand's open actions by score.
create index if not exists actions_brand_priority_idx
  on public.actions (brand_id, priority_score desc nulls last)
  where status not in ('completed', 'dismissed');

comment on column public.actions.priority_score is
  'How soon to work on the action beside the others, 0–100 (AC-006). Worked out on the server; null until first scored.';
comment on column public.actions.priority_level is
  'priority_score as a level: critical (90+), high (75–89), medium (50–74), low.';
comment on column public.actions.priority_reason is
  'The facts the score rests on, for "Why this priority?" (backend/src/lib/action-center/priority.js).';
