import { NextResponse } from 'next/server';
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { resolveAgentAuth } from '@/lib/agent/auth';
import { buildAgentTools } from '@/lib/agent/tools';
import { buildAgentSystemPrompt } from '@/lib/agent/systemPrompt';
import { AGENT_PROVIDER_OPTIONS, buildAgentModel } from '@/lib/agent/model';
import { resolveAgentModelConfig } from '@/lib/agent/key';
import { recordAgentTokenUsage } from '@/lib/agent/tokenQuota';
import { getPlan, hasFeature, type PlanId } from '@/config/plans';
import { subscriptionActiveFor, subscriptionInactiveResponse } from '@/lib/mcp/subscriptionGate';
import { legacyAgentApiGone } from '@/lib/chat/legacyRoute';

// Streaming responses up to 5 min — agent loops can run multiple tool
// calls plus a final generation, comfortably under this.
export const maxDuration = 300;

interface ChatBody {
  conversationId: string;
  messages: UIMessage[];
}

/**
 * POST /api/agent/chat
 *
 * Streaming chat endpoint for the in-product agent. Verifies the user is
 * signed in, the new Chat is off for the org (with it on, 404:
 * legacyAgentApiGone), the org's plan is active (a chat turn is an action: 402
 * subscription_inactive while the workspace is read-only, Cloud only), the
 * conversation belongs to them, the org's plan unlocks the
 * `ai_agent` feature, and the user hasn't blown through the monthly token
 * quota — then runs `streamText` with the MCP-data-backed tool surface and
 * streams the response back via `toUIMessageStreamResponse()`. Tokens are
 * billed at the end of the turn via the `onFinish` hook.
 *
 * The conversation row + user message must already exist before this is
 * called — the page creates the row, persists the user message, and only
 * then calls this endpoint with the full thread.
 */
export async function POST(req: Request) {
  const auth = await resolveAgentAuth();
  if (!auth || !auth.organizationId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const organizationId: string = auth.organizationId;
  const gone = legacyAgentApiGone(organizationId);
  if (gone) return gone;
  if (!(await subscriptionActiveFor(organizationId))) return subscriptionInactiveResponse();

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { conversationId, messages } = body;
  if (!conversationId || !Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json(
      { error: 'conversationId and a non-empty messages array are required' },
      { status: 400 },
    );
  }

  // Ownership: the conversation must belong to the calling user.
  const { data: conv } = await supabaseAdmin
    .from('agent_conversations')
    .select('id, user_id, organization_id, brand_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (!conv || conv.user_id !== auth.userId || conv.organization_id !== organizationId) {
    return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
  }

  let defaultBrand: { id: string; name: string } | undefined;
  if (conv.brand_id) {
    const { data: brand } = await supabaseAdmin
      .from('brands')
      .select('id, name')
      .eq('id', conv.brand_id)
      .eq('organization_id', organizationId)
      .maybeSingle();

    if (brand) {
      defaultBrand = brand;
    }
  }

  // Plan gate. On cloud the gate is intentionally loose — `ai_agent` is in
  // every paid plan's feature list; the *real* gate is whether the org has
  // pasted a provider key in Settings › AI Providers (BYOK). Self-host bypasses
  // both checks because the operator's env supplies everything.
  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('plan')
    .eq('id', organizationId)
    .maybeSingle();
  const plan = getPlan((org?.plan ?? 'starter') as PlanId);
  if (!hasFeature(plan, 'ai_agent')) {
    return NextResponse.json({ error: 'ai_agent is not enabled for this plan' }, { status: 403 });
  }

  // BYOK gate. Cloud customers paste a provider key in Settings › AI
  // Providers and the agent uses *that* key, with the provider they picked —
  // GetCito never pays for the customer's tokens. Missing key = 403 with a
  // code the UI can intercept to render the "add your key" CTA instead of a
  // generic error.
  const modelConfig = await resolveAgentModelConfig(organizationId);
  if (!modelConfig) {
    return NextResponse.json(
      {
        error: 'AI provider key required',
        code: 'missing_ai_key',
      },
      { status: 403 },
    );
  }

  const result = streamText({
    model: buildAgentModel(modelConfig),
    maxOutputTokens: 16000,
    system: buildAgentSystemPrompt(new Date(), defaultBrand),
    messages: await convertToModelMessages(messages),
    tools: buildAgentTools(auth),
    // streamText is single-step by default in v6 — without an explicit
    // stop condition the model fires a tool call and ends the turn before
    // ever seeing the result. stepCountIs(N) re-runs the generation after
    // each tool call so the agent can interpret what came back and either
    // answer or call another tool. 20 is the same default ToolLoopAgent
    // ships with — plenty of headroom for the typical "list_brands →
    // get_visibility_summary → answer" chain without burning tokens
    // forever on a pathological loop.
    stopWhen: stepCountIs(20),
    providerOptions: AGENT_PROVIDER_OPTIONS,
    onFinish: async ({ totalUsage }) => {
      // Bill the turn: every step's tokens (totalUsage), not only the last
      // step's (usage), which leaves out a turn's tool calls. Default to 0 if
      // nothing was billable.
      const promptTokens = totalUsage?.inputTokens ?? 0;
      const completionTokens = totalUsage?.outputTokens ?? 0;
      try {
        await recordAgentTokenUsage(auth.userId, organizationId, promptTokens, completionTokens);
      } catch (err) {
        console.error('[agent/chat] token recording failed:', err);
      }
    },
  });

  return result.toUIMessageStreamResponse({
    originalMessages: messages,
    onFinish: async ({ messages: finalMessages }) => {
      // Replace-in-place: drop the conversation's messages and write the
      // current full array back. The originalMessages option above lets
      // toUIMessageStreamResponse merge incoming + new — so finalMessages
      // contains the entire thread including the new user message and
      // every assistant / tool step from this turn. Single batched write
      // per turn; the trigger on agent_conversations bumps updated_at on
      // the conversation row (sidebar re-sort).
      try {
        await supabaseAdmin.from('agent_messages').delete().eq('conversation_id', conversationId);

        if (finalMessages.length > 0) {
          await supabaseAdmin.from('agent_messages').insert(
            finalMessages.map((m) => {
              const textParts = (m.parts ?? []).filter(
                (p): p is { type: 'text'; text: string } => p.type === 'text',
              );
              const text = textParts.map((p) => p.text).join('');
              return {
                conversation_id: conversationId,
                role: m.role as 'user' | 'assistant' | 'tool',
                content: text,
                // Persist the full UIMessage parts array so on hydrate we
                // can replay tool calls / results without re-deriving them.
                tool_calls: (m.parts ?? []) as unknown as Record<string, unknown>[],
              };
            }),
          );
        }

        // Auto-title from the first user message if the conversation is
        // still on its default placeholder. ~40 chars is enough for a
        // sidebar entry without forcing CSS truncation.
        const firstUser = finalMessages.find((m) => m.role === 'user');
        if (firstUser) {
          const textPart = (firstUser.parts ?? []).find(
            (p): p is { type: 'text'; text: string } => p.type === 'text',
          );
          const firstText = textPart?.text?.trim();
          if (firstText) {
            const candidate = firstText.length > 40 ? firstText.slice(0, 40) + '…' : firstText;
            await supabaseAdmin
              .from('agent_conversations')
              .update({ title: candidate })
              .eq('id', conversationId)
              .eq('title', 'New conversation');
          }
        }

        // Bump updated_at so the sidebar re-sorts this thread to the top.
        await supabaseAdmin
          .from('agent_conversations')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', conversationId);
      } catch (err) {
        console.error('[agent/chat] message persistence failed:', err);
      }
    },
  });
}
