-- Shopping merchant classification needed for "Where AI sends shoppers"
-- and weekly Amazon share alerts (#1277, #1284).

alter table public.prompt_result_shopping_cards
  add column if not exists merchant_kind text,
  add column if not exists marketplace text,
  add column if not exists listing_id text;

alter table public.prompt_result_shopping_cards
  drop constraint if exists prompt_result_shopping_cards_merchant_kind_check;

alter table public.prompt_result_shopping_cards
  add constraint prompt_result_shopping_cards_merchant_kind_check
  check (merchant_kind is null or merchant_kind in ('own', 'marketplace', 'reseller'));

create index if not exists prompt_result_shopping_cards_amazon_share_idx
  on public.prompt_result_shopping_cards (brand_id, matched_brand_role, created_at)
  include (marketplace)
  where merchant_kind is not null;

comment on column public.prompt_result_shopping_cards.merchant_kind is
  'Destination kind from classifyMerchant: own, marketplace, or reseller. Null means the card has no merchant URL and cannot be classified.';
comment on column public.prompt_result_shopping_cards.marketplace is
  'Normalized marketplace id (for example amazon, ebay, walmart); null for own stores, resellers, and unclassified cards.';
comment on column public.prompt_result_shopping_cards.listing_id is
  'Marketplace-native listing identifier when it can be extracted safely (for example an Amazon ASIN).';

-- Return five complete rolling seven-day windows ending at p_as_of. Every
-- bucket covers exactly seven days, including when p_as_of falls mid-week.
-- Only brand-matched own products with a classified merchant destination
-- enter the denominator; cards without a merchant URL stay unclassified.
create or replace function public.shopping_amazon_share_weekly(
  p_brand_id uuid,
  p_as_of timestamptz default now()
)
returns table (
  week_start date,
  amazon_cards bigint,
  classified_cards bigint
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
#variable_conflict use_column
begin
  if auth.role() is distinct from 'service_role' and not exists (
    select 1
    from public.brands b
    join public.profiles pf on pf.organization_id = b.organization_id
    where b.id = p_brand_id
      and pf.id = auth.uid()
  ) then
    return;
  end if;

  return query
  with weeks as (
    select
      g.i,
      p_as_of - (g.i + 1) * interval '7 days' as from_ts,
      p_as_of - g.i * interval '7 days' as to_ts
    from generate_series(0, 4) as g(i)
  )
  select
    (w.from_ts at time zone 'UTC')::date as week_start,
    count(c.id) filter (where c.marketplace = 'amazon') as amazon_cards,
    count(c.id) as classified_cards
  from weeks w
  left join public.prompt_result_shopping_cards c
    on c.brand_id = p_brand_id
   and c.matched_brand_role = 'own'
   and c.merchant_kind is not null
   and c.created_at >= w.from_ts
   and c.created_at < w.to_ts
  group by w.i, w.from_ts
  order by w.from_ts;
end;
$$;

revoke all on function public.shopping_amazon_share_weekly(uuid, timestamptz) from public, anon;
grant execute on function public.shopping_amazon_share_weekly(uuid, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
