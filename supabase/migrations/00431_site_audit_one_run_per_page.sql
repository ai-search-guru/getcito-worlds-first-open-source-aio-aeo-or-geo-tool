-- ============================================================================
-- 00431: one running audit per page, so the same page never costs twice
-- ============================================================================
-- Two requests for the same page at once (or /pricing, /pricing/ and
-- /pricing?utm=… one after another) each started an audit and each used a
-- credit. The server now starts an audit of a page only when none is running
-- for it (routes/audits.js createAndRunAudit), and this index makes the rule
-- hold when two requests race: the second insert fails and the server
-- answers with the audit already running, with no credit.
--
--   * page_key: the page an audit was asked for, as the server keys pages
--     (lib/audit/history.js pageKey of the normalized address): the host
--     without www., lowercased, and the path without a trailing slash; query
--     and fragment ignored. Filled here for the audits already kept.
--   * A run older than two hours was cut short by a restart and never
--     completes (history.js AUDIT_RUN_TIMEOUT_MS); it is marked failed, so it
--     doesn't hold its page. The server does the same before each start.
--   * Of two audits of one page running now, the older is marked failed so
--     the index can be built; it still completes if its job is alive.

alter table public.site_audits add column if not exists page_key text;

comment on column public.site_audits.page_key is
  'The page the audit was asked for: host without www., lowercased, path without a trailing slash, no query (history.js pageKey). One running audit per brand and page.';

with parts as (
  select
    a.id,
    case when btrim(a.url) ~* '^https?://' then btrim(a.url) else 'https://' || btrim(a.url) end
      as address
  from public.site_audits a
  where a.page_key is null
)
update public.site_audits s
set page_key =
  regexp_replace(
    lower(
      regexp_replace(
        regexp_replace(coalesce(substring(p.address from '^[A-Za-z]+://([^/?#]*)'), ''), '^.*@', ''),
        ':[0-9]*$',
        ''
      )
    ),
    '^www\.',
    ''
  )
  || coalesce(
    nullif(
      regexp_replace(coalesce(substring(p.address from '^[A-Za-z]+://[^/?#]*([^?#]*)'), ''), '/+$', ''),
      ''
    ),
    '/'
  )
from parts p
where p.id = s.id;

update public.site_audits
set status = 'failed',
    error = coalesce(error, 'The audit was cut short.'),
    completed_at = coalesce(completed_at, now())
where status = 'running'
  and created_at < now() - interval '2 hours';

with ranked as (
  select
    id,
    row_number() over (partition by brand_id, page_key order by created_at desc, id desc) as n
  from public.site_audits
  where status = 'running' and page_key is not null
)
update public.site_audits s
set status = 'failed',
    error = coalesce(s.error, 'Another audit of the page was already running.'),
    completed_at = coalesce(s.completed_at, now())
from ranked r
where r.id = s.id and r.n > 1;

create unique index if not exists site_audits_one_running_per_page
  on public.site_audits (brand_id, page_key)
  where status = 'running';

-- A start's look-up: the page's running audit and its audits finished in
-- the last minutes.
create index if not exists site_audits_brand_page_idx
  on public.site_audits (brand_id, page_key, completed_at desc);

notify pgrst, 'reload schema';
