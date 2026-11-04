-- A prompt's volume is the median of its keywords' Google volumes, not their
-- sum.
--
-- Volume analysis gives each prompt five head terms for its category
-- (backend/src/lib/intentExtraction.js) and looked up their Google volumes.
-- Their sum stood for the prompt, but the five overlap, so the same searchers
-- were counted several times over, and one very broad term ("google gemini",
-- 5M a month) could set the whole figure: a single prompt read ~755k
-- estimated AI searches a month, and the Insights total ran to millions.
-- summarizeVolumes (backend/src/lib/volumeAnalysis.js) now takes the median of
-- the keywords that have any volume; this applies the same rule to the rows
-- already stored, from the per-keyword volumes they keep, so no keyword is
-- looked up again. A row with no measured keyword stays at 0.
--
-- total_google_volume keeps its name; it now holds that median.

update public.prompt_volumes pv
set total_google_volume = m.google_volume,
    est_ai_volume = round(m.google_volume * pv.ai_volume_multiplier)::integer
from (
  select p.id,
         coalesce(round(percentile_cont(0.5) within group (order by k.volume)), 0)::integer
           as google_volume
  from public.prompt_volumes p
  left join lateral (
    select e.value::numeric as volume
    from jsonb_each_text(p.google_volumes) e
    -- Only numbers are cast; the case keeps the cast behind the check.
    where case when e.value ~ '^[0-9]+(\.[0-9]+)?$' then e.value::numeric > 0 else false end
  ) k on true
  group by p.id
) m
where m.id = pv.id
  and (pv.total_google_volume is distinct from m.google_volume
       or pv.est_ai_volume is distinct from round(m.google_volume * pv.ai_volume_multiplier)::integer);

comment on column public.prompt_volumes.total_google_volume is
  'The prompt''s Google volume: the median of google_volumes'' measured keywords (named before the median replaced their sum).';
