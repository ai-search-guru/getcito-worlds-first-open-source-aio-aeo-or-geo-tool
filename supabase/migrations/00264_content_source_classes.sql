-- ============================================================================
-- 00264: Quality phase 2, CE-046 (part b) — AI reads of sources' kinds
-- ============================================================================
-- Trust reads what kind of source each of a page's links is by rules first
-- (00263's part a). A site the rules can't place is read by the model once,
-- as primary, secondary or weak (unknown when it doesn't know the site,
-- kept a day), and kept for every workspace for 90 days:
-- what kind of site a public website is isn't any workspace's own data, and
-- one read serves them all. Only the site's address goes to the model.
--
-- The reads draw on the workspace's AI budget as their own feature,
-- "quality", so the Billing meter shows them apart and their small holds
-- don't set the hold of the Content Agent's larger calls (holdCostUsd).

alter table public.prompt_improve_usage
  drop constraint if exists prompt_improve_usage_feature_check;
alter table public.prompt_improve_usage
  add constraint prompt_improve_usage_feature_check
    check (feature is null or feature in ('improve', 'content', 'action_center', 'quality'));

comment on column public.prompt_improve_usage.feature is
  'What the AI call was for: improve (the Improve tab), content (the Content Editor''s AI), action_center (the task writer) or quality (the Content Editor''s Quality checks, 00264). Null on rows from before 00242 whose prompt, draft or action was deleted.';

create table if not exists public.content_source_classes (
  -- A site as the citations name it: lower case, without "www.", and a
  -- public DNS name only (letters, digits and hyphens in each label, a dot
  -- at least, a letter top-level domain): no IP address, no single-label
  -- name, as the API and the editor take them (SITE_NAME).
  host text primary key
    check (
      char_length(host) between 1 and 253
      and host ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
      and host !~ '^www\.'
    ),
  -- unknown: the model doesn't know the site; Trust leaves it out, and the
  -- read is asked again after a day.
  kind text not null check (kind in ('primary', 'secondary', 'weak', 'unknown')),
  model text check (model is null or char_length(model) <= 100),
  classified_at timestamptz not null default now()
);

alter table public.content_source_classes enable row level security;
revoke all on table public.content_source_classes from anon, authenticated;
grant all on table public.content_source_classes to service_role;

comment on table public.content_source_classes is
  'Quality CE-046 (00264): the kind of source a site is (primary, secondary or weak; unknown when the model doesn''t know it), as the model read it for a site the rules can''t place. Kept 90 days (unknown, a day), shared by every workspace; server-only.';

notify pgrst, 'reload schema';
