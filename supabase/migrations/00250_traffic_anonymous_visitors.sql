-- ============================================================================
-- 00250: the tracking snippet's visitors, without their IP addresses (GDPR)
-- ============================================================================
-- ai_traffic_logs kept each AI-referred visitor's IP address. It was only
-- needed to tell one visitor's pageviews from another's for half an hour
-- (a visit, 00172) and to find the pageview a not-found title belongs to
-- (00200).
--
-- The server now stores a visitor key instead (backend/src/lib/visitorKey.js):
-- a one-way hash of the IP address, the brand and a salt that changes every
-- day. Each day's salt is made here on first use and deleted after two days,
-- so once it is gone nothing links its keys to an address, and a visitor's
-- days can't be joined. Visits are grouped by the key and the user agent, as
-- they were by the IP address; a visit across midnight (UTC) counts as two.
--
-- The IP addresses already stored are erased. The visits they grouped are
-- kept: each pageview's visit_of was decided when it was stored.

create table if not exists public.traffic_daily_salts (
  day  date primary key,
  salt text not null
);

comment on table public.traffic_daily_salts is
  'One random salt per UTC day for the tracking snippet''s visitor keys (00250). Kept two days, then deleted by traffic_salt.';

alter table public.traffic_daily_salts enable row level security;
revoke all on table public.traffic_daily_salts from anon, authenticated;
grant all on table public.traffic_daily_salts to service_role;

-- The salt of p_day, made on first use; salts older than the day before
-- are deleted on the way.
create or replace function public.traffic_salt(p_day date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salt text;
begin
  delete from public.traffic_daily_salts where day < p_day - 1;

  insert into public.traffic_daily_salts (day, salt)
  values (p_day, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
  on conflict (day) do nothing;

  select salt into v_salt from public.traffic_daily_salts where day = p_day;
  return v_salt;
end;
$$;

revoke all on function public.traffic_salt(date) from public, anon, authenticated;
grant execute on function public.traffic_salt(date) to service_role;

alter table public.ai_traffic_logs
  add column if not exists visitor_key text;

comment on column public.ai_traffic_logs.visitor_key is
  'A one-way key for the visitor, from their IP address, the brand and the day''s salt (00250); groups a visit''s pageviews. The IP address itself is not stored.';

comment on column public.ai_traffic_logs.ip_address is
  'No longer written (00250): the IP address is not stored. Null on every row.';

update public.ai_traffic_logs
set ip_address = null
where ip_address is not null;
