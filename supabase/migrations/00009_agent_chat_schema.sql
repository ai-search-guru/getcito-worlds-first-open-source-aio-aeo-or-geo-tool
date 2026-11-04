-- In-product AI agent: schema for conversations, messages, and per-user
-- monthly token usage (#94 Phase 2).
--
-- Three tables, each scoped to a user inside an organization:
--
--   agent_conversations   one chat thread; "+ new chat" creates a row
--   agent_messages        ordered messages within a thread; tool calls
--                         stored alongside text content as jsonb
--   agent_token_usage     monthly bucket per user so the cost-guard can
--                         enforce plan-level quotas without scanning the
--                         messages table on every request
--
-- RLS scopes everything to auth.uid() — users can only see their own
-- conversations / messages / usage. The chat API runs server-side with
-- supabaseAdmin so it can write tool results that the user didn't author;
-- service_role bypasses RLS naturally.

-- ── agent_conversations ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.agent_conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Optional default brand context: a new chat opened from a brand-specific
  -- page can pin the conversation to that brand so subsequent tool calls
  -- don't need to re-resolve the brand id every turn. Null = no pin.
  brand_id        uuid REFERENCES public.brands(id) ON DELETE SET NULL,
  title           text NOT NULL DEFAULT 'New conversation',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Recency-sorted lookup per user is the hot path (sidebar list).
CREATE INDEX IF NOT EXISTS idx_agent_conversations_user_updated
  ON public.agent_conversations (user_id, updated_at DESC);


-- ── agent_messages ──────────────────────────────────────────────────────
-- Roles match the Vercel AI SDK / OpenAI shape so we can hydrate the chat
-- panel and feed the SDK's tool-calling loop without re-mapping:
--
--   user        regular user message; `content` holds the text
--   assistant   model output; `content` may be empty if the model only
--               emitted tool calls; `tool_calls` holds the array
--   tool        result of a tool call; `tool_call_id` joins back to the
--               assistant message's tool_calls entry; `tool_result` holds
--               the JSON payload returned by the tool
CREATE TABLE IF NOT EXISTS public.agent_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.agent_conversations(id) ON DELETE CASCADE,
  role            text NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content         text NOT NULL DEFAULT '',
  tool_calls      jsonb,
  tool_call_id    text,
  tool_name       text,
  tool_result     jsonb,
  -- Token usage attributed to this message for analytics + the monthly
  -- bucket below. Null on user/tool rows; filled on the assistant
  -- response once the SDK stream finishes.
  prompt_tokens     int,
  completion_tokens int,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_messages_conv_created
  ON public.agent_messages (conversation_id, created_at);


-- ── agent_token_usage ───────────────────────────────────────────────────
-- One row per (user, organization, year_month). The chat API upserts on
-- this row at the end of every streamed response, so quota enforcement is
-- one SELECT instead of an aggregate scan over agent_messages.
CREATE TABLE IF NOT EXISTS public.agent_token_usage (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- 'YYYY-MM' (UTC). Stored as text so it's portable + lex-sortable.
  year_month         text NOT NULL,
  prompt_tokens      bigint NOT NULL DEFAULT 0,
  completion_tokens  bigint NOT NULL DEFAULT 0,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, organization_id, year_month)
);

CREATE INDEX IF NOT EXISTS idx_agent_token_usage_user_month
  ON public.agent_token_usage (user_id, year_month);


-- ── RLS ────────────────────────────────────────────────────────────────
ALTER TABLE public.agent_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.agent_token_usage   ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own conversations" ON public.agent_conversations
  FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Users write own conversations" ON public.agent_conversations
  FOR ALL USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users read own messages" ON public.agent_messages
  FOR SELECT USING (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  ));
CREATE POLICY "Users write own messages" ON public.agent_messages
  FOR ALL USING (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  )) WITH CHECK (conversation_id IN (
    SELECT id FROM public.agent_conversations WHERE user_id = auth.uid()
  ));

-- Read-only via RLS so the dashboard can display the user's own usage.
-- The chat API writes via supabaseAdmin (service_role bypasses RLS).
CREATE POLICY "Users read own usage" ON public.agent_token_usage
  FOR SELECT USING (user_id = auth.uid());


-- ── updated_at trigger ──────────────────────────────────────────────────
-- Conversations: touch updated_at when title or brand_id changes (sidebar
-- sort key) and when a new message is inserted (handled at the API layer).
CREATE OR REPLACE FUNCTION public.touch_agent_conversation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_conversations_touch_updated_at
  BEFORE UPDATE ON public.agent_conversations
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_conversation_updated_at();

CREATE OR REPLACE FUNCTION public.touch_agent_token_usage_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_agent_token_usage_touch_updated_at
  BEFORE UPDATE ON public.agent_token_usage
  FOR EACH ROW EXECUTE FUNCTION public.touch_agent_token_usage_updated_at();
