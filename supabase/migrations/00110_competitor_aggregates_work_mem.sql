-- Competitors page: let competitor_aggregates_daily sort in memory.
--
-- The function counts distinct prompts per competitor and per engine over
-- the competitor-prompt rollup — ~240k rows on the largest brand's 30-day
-- window — and with the default 5 MB work_mem each of those sorts spilled
-- to disk (~20 MB). 64 MB keeps them in memory: 5.35 s -> 4.4 s on that
-- window, as the page runs it. The citation reads already set 96 MB.
--
-- If this function is ever recreated (CREATE OR REPLACE resets its
-- settings), keep `set work_mem = '64MB'` on the new definition.

alter function public.competitor_aggregates_daily(uuid, text, text[], text, date, date)
  set work_mem = '64MB';
