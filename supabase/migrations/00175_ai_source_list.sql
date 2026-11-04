-- ============================================================================
-- 00175: one versioned AI source list for the snippet and Google Analytics (AT-004)
-- ============================================================================
-- The tracking snippet and the Google Analytics sync each had their own list
-- of AI assistants, and they disagreed: the snippet stored chat.openai.com
-- as an engine of its own and didn't know Grok or DeepSeek; the sync didn't
-- know Google Labs or subdomains. Both now read backend/src/lib/ai-sources.json
-- (spec §5.1), which names each engine by one key.
--
--   * source_list_version records the list version that counted a row, so a
--     step in the history can be traced to a change of the list rather than
--     of the traffic. Null on rows stored before the list was versioned
--     (version 1: the two separate lists) and on visits from a cached copy of
--     the old snippet.
--   * The snippet's rows stored before it are moved onto the list's keys:
--     chat.openai.com and the bare names some old snippets sent ("chatgpt",
--     "gemini") become chatgpt.com and gemini.google.com, so one engine is
--     one row in every breakdown. Every pageview of a visit carries the same
--     value, so visits stay grouped (00172). Google Analytics rows already
--     use the keys; a history backfill re-reads them with the new list.

alter table public.ai_traffic_logs
  add column if not exists source_list_version smallint;

alter table public.ga_ai_traffic_stats
  add column if not exists source_list_version smallint;

comment on column public.ai_traffic_logs.source_list_version is
  'The AI source list version (backend/src/lib/ai-sources.json) that counted this visit; null before the list was versioned or from a cached older snippet (AT-004).';

comment on column public.ga_ai_traffic_stats.source_list_version is
  'The AI source list version (backend/src/lib/ai-sources.json) that classified this row; null before the list was versioned (AT-004).';

update public.ai_traffic_logs t
set source_platform = m.key
from (
  values
    ('chat.openai.com', 'chatgpt.com'),
    ('search.chatgpt.com', 'chatgpt.com'),
    ('chatgpt', 'chatgpt.com'),
    ('openai', 'chatgpt.com'),
    ('openai.com', 'chatgpt.com'),
    ('perplexity', 'perplexity.ai'),
    ('www.perplexity.ai', 'perplexity.ai'),
    ('claude', 'claude.ai'),
    ('gemini', 'gemini.google.com'),
    ('bard', 'gemini.google.com'),
    ('bard.google.com', 'gemini.google.com'),
    ('copilot', 'copilot.microsoft.com'),
    ('grok', 'grok.com'),
    ('deepseek', 'deepseek.com'),
    ('chat.deepseek.com', 'deepseek.com')
) as m (raw, key)
where lower(t.source_platform) = m.raw;
