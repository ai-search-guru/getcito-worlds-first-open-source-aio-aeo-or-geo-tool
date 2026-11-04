-- ============================================================================
-- 00462: what the model menu needs from the price catalog, and how many
-- images a spend row paid for
-- ============================================================================
-- Chat Wave 4 (CHAT-16 §A, CHAT-15 §E), behind CHAT_AGENTIC. Nothing reads
-- these yet: the model menu (W4-01) and image metering (W4-07) come next.
--
--   * chat_model_prices (00404) gains two catalog fields the daily sync
--     (server lib/modelPrices.js) writes from OpenRouter's public catalog:
--       - supported_parameters: what the model takes ("tools", "reasoning",
--         "structured_outputs", …). Chat's engine can't run without tool
--         calls, so the menu offers only a model that lists "tools". Null
--         until the next sync lists the model again.
--       - context_length: its context window in tokens, as the catalog gives
--         it. Null where the catalog gives none.
--     The table stays the server's: no member reads it (dollars never reach
--     a browser).
--   * prompt_improve_usage.units: how many images a row paid for (an image
--     request's 1–4 variants, the editor's 2–4). Null on every token row. An
--     image row is charged at the provider's real cost, with no markup (owner
--     decision 2026-11-02), on the same budget and the same reservation as
--     a model step; units only says what the dollars bought.

-- ─── The model catalog ──────────────────────────────────────────────────────

alter table public.chat_model_prices
  add column if not exists supported_parameters text[] check (
    supported_parameters is null or cardinality(supported_parameters) <= 64
  ),
  add column if not exists context_length integer check (
    context_length is null or context_length > 0
  );

comment on column public.chat_model_prices.supported_parameters is
  'OpenRouter''s supported_parameters as given ("tools", "reasoning", "structured_outputs"…): the model menu offers only a model that lists "tools" (00462). Null until a sync lists the model.';
comment on column public.chat_model_prices.context_length is
  'The model''s context window in tokens, from the catalog (00462). Null where it gives none.';

-- ─── Images on a spend row ──────────────────────────────────────────────────

alter table public.prompt_improve_usage
  add column if not exists units smallint;

alter table public.prompt_improve_usage
  drop constraint if exists prompt_improve_usage_units_check;
alter table public.prompt_improve_usage
  add constraint prompt_improve_usage_units_check
    check (units is null or (units between 1 and 10 and feature = 'image'));

comment on column public.prompt_improve_usage.units is
  'How many images an image row paid for (00462; CHAT-15 §E): 1–10. Null on token rows. The row''s cost_usd is the provider''s real cost for them, with no markup.';

notify pgrst, 'reload schema';
