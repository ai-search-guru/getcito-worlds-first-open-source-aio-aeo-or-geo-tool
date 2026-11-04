-- ============================================================================
-- 00227: a workspace's own rules per kind of site (Content Editor, CE-009)
-- ============================================================================
-- My rules (00214) were kept per organization and page type. Since the page
-- types follow the brand's kind of site (00205), a type such as "guide" (a
-- How-to guide) is written on a B2B site, a shop and a travel site alike, so
-- a set saved for one brand applied to the same organization's brands of
-- another kind, with rules meant for that site.
--
--   * content_rule_sets gets site_type, the brand's kind of site when the set
--     was saved (b2b, ecommerce or b2c, as brands.site_type), and the key
--     becomes (organization_id, site_type, page_type).
--   * A set saved before keeps applying where it did: it is copied to each
--     kind of site. The member policies are by organization and stay as they
--     are.

alter table public.content_rule_sets
  add column if not exists site_type text not null default 'b2b'
    check (site_type in ('b2b', 'ecommerce', 'b2c'));

alter table public.content_rule_sets drop constraint if exists content_rule_sets_pkey;
alter table public.content_rule_sets
  add constraint content_rule_sets_pkey primary key (organization_id, site_type, page_type);

insert into public.content_rule_sets (
  organization_id, site_type, page_type, overrides, text_rules, updated_by, updated_at
)
select r.organization_id, s.site_type, r.page_type, r.overrides, r.text_rules, r.updated_by,
  r.updated_at
from public.content_rule_sets r
cross join (values ('ecommerce'), ('b2c')) as s(site_type)
where r.site_type = 'b2b'
on conflict do nothing;

-- Every save names its kind of site.
alter table public.content_rule_sets alter column site_type drop default;

comment on column public.content_rule_sets.site_type is
  'Content Editor (CE-009): the kind of site the set is for (b2b, ecommerce or b2c, as brands.site_type); a brand''s drafts start from its own kind''s set.';
