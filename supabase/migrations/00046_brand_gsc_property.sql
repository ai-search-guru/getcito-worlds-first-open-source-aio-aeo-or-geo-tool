-- Brand → Search Console property mapping (#642).
--
-- The GSC connection is org-level (integration_connections); the property
-- choice is brand-level. Exactly one property per brand, so a column beats a
-- mapping table. Values are GSC siteUrl strings: either a URL-prefix
-- ("https://example.com/") or a domain property ("sc-domain:example.com").
-- Kept on disconnect so reconnecting restores functionality without
-- re-picking.

ALTER TABLE public.brands ADD COLUMN gsc_property text;
