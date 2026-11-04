-- Fix `column reference "url" is ambiguous` in citation_url_ids (#732).
--
-- `returns table (id bigint, url text)` declares those names as PL/pgSQL
-- variables, so `on conflict (url)` inside the body could mean either the
-- variable or the column, and PL/pgSQL refuses to guess. The function was
-- therefore broken for every call — 00059 shipped it having been parsed but
-- never executed, and the unit tests around it mock the database, so neither
-- could see it.
--
-- `#variable_conflict use_column` is the documented resolution: an ambiguous
-- name resolves to the column, which is what every reference in this body
-- means. Renaming the output columns would work too and would change the
-- shape the caller reads, for no benefit here.

create or replace function public.citation_url_ids(p_urls jsonb)
returns table (id bigint, url text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
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

revoke all on function public.citation_url_ids(jsonb) from public;
revoke all on function public.citation_url_ids(jsonb) from anon;
revoke all on function public.citation_url_ids(jsonb) from authenticated;
grant execute on function public.citation_url_ids(jsonb) to service_role;
