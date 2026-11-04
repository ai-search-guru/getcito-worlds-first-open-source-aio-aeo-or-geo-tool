-- Brand → Google Analytics property mapping (#694).
--
-- Mirrors gsc_property (00046): the Analytics connection is org-level
-- (integration_connections), the property choice is brand-level, and exactly
-- one property per brand means a column beats a mapping table. Values are the
-- bare GA4 numeric property id ("365372770") rather than the API's
-- "properties/365372770" resource name — the prefix is constant and is added
-- back when calling the Admin/Data APIs. Kept on disconnect so reconnecting
-- restores functionality without re-picking.

ALTER TABLE public.brands ADD COLUMN ga_property_id text;
