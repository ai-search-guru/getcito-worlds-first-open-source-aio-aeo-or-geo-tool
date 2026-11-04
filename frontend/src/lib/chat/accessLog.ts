import { recordActivity } from './activity';
import type { ChatSurface, ToolDenial } from './precedence';
import type { ToolClass } from './registry/defineTool';

/**
 * Every denial Chat gives is recorded as an `access.denied` event (CHAT-20
 * §4c): who was refused which tool, why, on which brand and surface. It
 * shows in the person's own Activity log rows and to Admins, and feeds the
 * gap log (CHAT-19). A denial has no Undo.
 *
 * One way in for every place that refuses a call: the run's tool-call step
 * when the precedence denies (decideOrDeny, then buildDenial for the
 * answer), and MCP's. Each one is an `access.denied` row of the Activity log
 * (activity.ts, 00402). Server only.
 */

export interface AccessDeniedContext {
  userId: string;
  organizationId: string;
  /** The brand the call was about; null for none, or one out of the person's scope. */
  brandId: string | null;
  /** The registry row's label key (chatTools.{key}): never a tool's name. */
  toolKey: string;
  toolClass: ToolClass;
  surface: ChatSurface;
  conversationId?: string | null;
  runId?: string | null;
}

/** The event as the log keeps it: ids, the label key and the rule, nothing a person wrote. */
export function accessDeniedEvent(ctx: AccessDeniedContext, denial: ToolDenial) {
  const { code, ...detail } = denial;
  return {
    kind: 'access.denied' as const,
    userId: ctx.userId,
    organizationId: ctx.organizationId,
    // Out of scope, the brand isn't the person's to see named, even in their own log.
    brandId: code === 'brand_scope' ? null : ctx.brandId,
    toolKey: ctx.toolKey,
    toolClass: ctx.toolClass,
    surface: ctx.surface,
    reason: code,
    detail,
    conversationId: ctx.conversationId ?? null,
    runId: ctx.runId ?? null,
  };
}

/**
 * Records one denial as its Activity log row. Never throws: a failed record
 * doesn't change the answer, and goes to the server's log instead.
 */
export async function recordAccessDenied(
  ctx: AccessDeniedContext,
  denial: ToolDenial,
): Promise<void> {
  const event = accessDeniedEvent(ctx, denial);
  try {
    await recordActivity(event);
  } catch (err) {
    try {
      console.error('[chat] could not record access.denied', JSON.stringify(event), err);
    } catch {
      // Logging must not fail the run.
    }
  }
}
