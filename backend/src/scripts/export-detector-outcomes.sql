-- Detector thresholds against outcomes (learning C6): exports one brand's
-- closed actions (completed or dismissed) with the signals that opened them,
-- one JSON object a line, for src/scripts/calibrateDetectorThresholds.js.
--
-- The signals are read from the action's baseline (actions.baseline.signals,
-- lib/action-center/generate.js): their values when it opened. A signal's own
-- row is no record of that: its values are rewritten every night it stays
-- open, and an action takes signals as evidence after it opened too. Closed
-- actions with linked signals but no baseline of them (older ones) are left
-- out, and counted on the last line.
--
-- Run it on one brand (GetCito's own, or your own self-hosted data).
-- Running it across customers' brands is not supported; it waits on the
-- cross-brand learning decision (C5) and a privacy policy update.
--
-- Run from backend/, with psql (it only reads), writing outside the repository:
--   psql "<database url>" -X -q -A -t -v brand_id=<brand uuid> \
--     -f src/scripts/export-detector-outcomes.sql > ~/outcomes.jsonl
--
-- brand_id is required; without it the script stops with an error. A line
-- holds the action's id (so each action counts once per signal kind), the
-- signal's kind and values, and how the action ended: no payload, prompt,
-- URL or competitor.

\set ON_ERROR_STOP on
set default_transaction_read_only = on;

\if :{?brand_id}
\else
  \warn 'Usage: psql "<database url>" -X -q -A -t -v brand_id=<brand uuid> -f src/scripts/export-detector-outcomes.sql > ~/outcomes.jsonl'
  do $$ begin raise exception 'brand_id is required: the export reads one brand only'; end $$;
\endif

select json_build_object(
         'action', a.id,
         'kind', b->>'kind',
         'current', b->'currentValue',
         'change', b->'changeValue',
         'status', a.status,
         'outcome', a.outcome,
         'dismissReason', a.dismiss_reason
       )
  from public.actions a
 cross join lateral jsonb_array_elements(
         case when jsonb_typeof(a.baseline->'signals') = 'array'
              then a.baseline->'signals' else '[]'::jsonb end
       ) b
 where a.brand_id = :'brand_id'::uuid
   and a.deleted_at is null
   and a.status in ('completed', 'dismissed')
 order by a.created_at, a.id, b->>'kind';

select json_build_object('withoutBaseline', count(*))
  from public.actions a
 where a.brand_id = :'brand_id'::uuid
   and a.deleted_at is null
   and a.status in ('completed', 'dismissed')
   and exists (select 1 from public.action_signals l where l.action_id = a.id)
   and case when jsonb_typeof(a.baseline->'signals') = 'array'
            then jsonb_array_length(a.baseline->'signals')
            else 0 end = 0;
