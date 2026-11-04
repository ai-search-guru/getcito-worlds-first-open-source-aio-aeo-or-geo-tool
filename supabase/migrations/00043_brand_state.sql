-- US state-level geo-targeting for AI prompt tracking (#554).
--
-- Optional two-letter USPS state code on the brand. NULL = nationwide, which
-- keeps the current behavior for every existing brand. The tracking worker
-- forwards it to the scraping provider only for US brands on the AI endpoints
-- (Google AIO / AI Mode use a different sub-country mechanism and never see
-- this column).

ALTER TABLE public.brands
  ADD COLUMN state text
  CHECK (state IS NULL OR state ~ '^[A-Z]{2}$');
