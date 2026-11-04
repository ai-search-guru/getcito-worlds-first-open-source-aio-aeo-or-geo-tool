-- ============================================================================
-- 00404: the models' prices, synced daily from OpenRouter's public catalog
-- ============================================================================
-- Chat (CHAT-16 §A, CHAT-00 `model_price`), behind CHAT_AGENTIC: a daily job
-- reads https://openrouter.ai/api/v1/models (public, no key) and keeps every
-- model's price here (backend/src/lib/modelPrices.js). What a model call costs
-- is read from it first, and from the server's own table when a model isn't
-- here (lib/improveCost.js); multipliers (Auto = 1x) are worked out from it
-- on the server.
--
--   * Prices are USD per million tokens (OpenRouter's per-token prices ×
--     1,000,000); null where OpenRouter gives none or a variable one ("-1").
--   * overrides: OpenRouter's pricing.overrides as given. A time window
--     (utc_days, utc_start/utc_end as HHMM) or a prompt size
--     (min_prompt_tokens), each with the prices that apply in it.
--   * is_batch: a ":batch" variant, kept as its own row and never offered.
--   * synced_at: the last sync that listed the model. A model the catalog
--     drops keeps its last row: a failed or partial sync never loses prices.
--
-- Dollars never reach a browser (CHAT-04, owner decision 2026-10-27): no
-- policy lets a member read this table; only the server does.

create table if not exists public.chat_model_prices (
  model_id text primary key check (char_length(model_id) between 1 and 200),
  name text not null default '',
  provider text not null default '',
  input_modalities text[] not null default '{}',
  output_modalities text[] not null default '{}',
  input_per_m numeric check (input_per_m is null or input_per_m >= 0),
  output_per_m numeric check (output_per_m is null or output_per_m >= 0),
  cache_read_per_m numeric check (cache_read_per_m is null or cache_read_per_m >= 0),
  image_output_per_m numeric check (image_output_per_m is null or image_output_per_m >= 0),
  overrides jsonb not null default '[]'::jsonb check (jsonb_typeof(overrides) = 'array'),
  is_batch boolean not null default false,
  synced_at timestamptz not null default now()
);

comment on table public.chat_model_prices is
  'CHAT-16 §A: OpenRouter''s public model catalog, synced daily (modelPrices.js). USD per million tokens; server only, never sent to a browser.';
comment on column public.chat_model_prices.overrides is
  'OpenRouter pricing.overrides as given: a UTC time window (utc_days, utc_start/utc_end HHMM) or a prompt size (min_prompt_tokens) with its per-token prices.';
comment on column public.chat_model_prices.synced_at is
  'The last sync that listed the model; a model the catalog drops keeps its last row.';

alter table public.chat_model_prices enable row level security;
revoke all on table public.chat_model_prices from anon, authenticated;
grant all on table public.chat_model_prices to service_role;
