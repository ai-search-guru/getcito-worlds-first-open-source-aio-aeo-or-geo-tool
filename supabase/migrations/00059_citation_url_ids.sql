-- Resolve citation URLs to dictionary ids through the request body (#732).
--
-- The write path looked URLs up with a PostgREST `.in()` filter, which is
-- spelled out in the query string. That was wrong three times over: first
-- unbounded, then chunked at 100, and it still failed — URLs are
-- percent-encoded on the way into a URI, so a hundred of them at an average
-- 92 characters (and up to 1,333) exceeds the request-line and header limits
-- in front of PostgREST. The symptom was `Bad Request` from the proxy and
-- `TypeError: fetch failed` when the connection was reset, on precisely the
-- answers carrying the most citations: 182 of 174,466 after the second fix.
--
-- Chunking smaller would have been another guess at someone else's limit.
-- This removes the class instead: the URLs travel as a jsonb argument in the
-- POST body, which has no such bound, and one call both inserts what is new
-- and returns ids for everything asked about.

create or replace function public.citation_url_ids(p_urls jsonb)
returns table (id bigint, url text)
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  -- p_urls: [{"url": "...", "domain": "...", "title": "..."}, ...]
  --
  -- `distinct on` because one answer can cite the same page twice, and the
  -- unique index would reject the second copy inside the same statement
  -- rather than treating it as a conflict.
  insert into public.citation_urls (url, domain, title)
  select distinct on (e.value ->> 'url')
         e.value ->> 'url',
         e.value ->> 'domain',
         nullif(e.value ->> 'title', '')
  from jsonb_array_elements(p_urls) e
  where e.value ->> 'url' is not null
    and e.value ->> 'domain' is not null
  order by e.value ->> 'url'
  on conflict (url) do nothing;

  -- Returned for every URL asked about, not only the ones just inserted:
  -- the caller needs an id per citation, and the overwhelming majority were
  -- already in the dictionary. A concurrent writer that won the insert race
  -- is picked up here too, which is what makes the call safe to run twice.
  return query
  select cu.id, cu.url
  from public.citation_urls cu
  join (
    select distinct e.value ->> 'url' as u
    from jsonb_array_elements(p_urls) e
  ) asked on asked.u = cu.url;
end;
$$;

-- The dictionary is cross-tenant and has no select policy of its own, so this
-- function is the only way in. It is SECURITY DEFINER to reach past that, and
-- therefore must not be callable by anyone who should not be writing to the
-- table: the tracking worker and the backfill both go through the service
-- role, and nothing else has any reason to call it.
revoke all on function public.citation_url_ids(jsonb) from public;
revoke all on function public.citation_url_ids(jsonb) from anon;
revoke all on function public.citation_url_ids(jsonb) from authenticated;
grant execute on function public.citation_url_ids(jsonb) to service_role;

comment on function public.citation_url_ids(jsonb) is
  'Insert any unseen citation URLs and return the dictionary id for every URL asked about. Takes its argument in the request body so a long list cannot overflow the query string, which is what broke the .in() lookup it replaces (#732).';
