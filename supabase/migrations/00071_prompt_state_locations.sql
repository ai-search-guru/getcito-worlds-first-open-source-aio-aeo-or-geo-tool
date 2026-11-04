-- Move state targeting from the brand onto the prompt (#691 part 2).
--
-- APPLY AFTER DEPLOYING THE SERVER, not before. The running worker passes a
-- prompt's region straight through as the Cloro `country` field, so a row
-- reading `US-DE` would be submitted as country "US-DE" and rejected — this
-- brand's tracking would fail until the deploy landed. The new worker parses
-- the code first, so once it is live the order no longer matters.
--
-- `brands.state` was a single USPS code the tracking worker applied to every
-- US task the brand ran (#554). Targeting now lives on the prompt, as a
-- location code in `prompts.regions` (`US-CA`), so different prompts can
-- track different places — and the worker no longer reads `brands.state` at
-- all. Left alone, that would silently downgrade the brands that had a state
-- set: their prompts would keep saying `US` and start running country-wide.
--
-- So fold the brand's state into its own prompts' `US` entries, once. Other
-- countries are untouched: the state only ever applied to US tasks.
--
-- Quota is unaffected — a prompt targeting `US-DE` tracks exactly one
-- location, the same as one targeting `US` (#691 part 1 counts entries, not
-- codes), so no org's usage or limit standing moves.
--
-- The column itself stays, with a narrower job: it is the DEFAULT location
-- offered to prompts created for that brand, not a tracking-time override.
-- Two sources of truth for "where does this prompt run" is exactly the
-- conflict this migration removes.
update public.prompts p
set regions = (
  select array_agg(
    case when r = 'US' then 'US-' || b.state else r end
    order by idx
  )
  from unnest(p.regions) with ordinality as t(r, idx)
)
from public.prompt_sets ps, public.brands b
where ps.id = p.prompt_set_id
  and b.id = ps.brand_id
  and b.state is not null
  and b.state ~ '^[A-Z]{2}$'
  and 'US' = any(p.regions);

comment on column public.brands.state is
  'Default US state for prompts created for this brand (#691). Targeting itself lives in prompts.regions as location codes (US-CA); the tracking worker does not read this column.';
