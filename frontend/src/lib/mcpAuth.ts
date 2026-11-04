import { createHash, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { brandAccessOf, readAccessProfile, type BrandAccess } from '@/lib/brandAccess';
import { supabaseAdmin } from '@/lib/supabase/admin';
import {
  mcpWriteAccess,
  planRequiredResponse,
  subscriptionInactiveResponse,
} from '@/lib/mcp/subscriptionGate';
import type { UserRole } from '@/types';

export const API_KEY_PREFIX = 'getcito_';
export const API_KEY_DISPLAY_PREFIX_LEN = API_KEY_PREFIX.length + 8;

export function generateApiKey(): { token: string; hash: string; prefix: string } {
  const token = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
  const hash = createHash('sha256').update(token).digest('hex');
  const prefix = token.slice(0, API_KEY_DISPLAY_PREFIX_LEN);
  return { token, hash, prefix };
}

export function hashApiKey(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface McpAuthContext {
  userId: string;
  email: string | null;
  organizationId: string | null;
  /** The user's role in the organization: the tools that need one check it (lib/mcp/roleGate.ts). */
  role: UserRole | null;
  apiKeyId: string;
  /**
   * The brands the user may use, when the caller read them already (an API
   * key's request, Chat's precedence for each call); absent, a tool reads
   * them itself (lib/brandAccess.ts brandAccessFor).
   */
  brandAccess?: BrandAccess | null;
}

/** The methods that change something: a read-only workspace's REST routes refuse them. */
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Resolve the bearer token on a request into a user/org context.
 *
 * Accepts only GetCito API keys (prefix `getcito_`) — not Supabase session JWTs.
 * MCP endpoints are intended to be hit by long-lived external clients, so we
 * intentionally don't fall back to the dashboard's session cookie.
 *
 * A key belongs to a person, so it carries their brand access (BRAND-ACCESS
 * §5.3): All brands, or the ones shared with them, read once per request
 * for the tools to check. A read that fails answers 503: no tool runs on
 * access it couldn't read.
 *
 * On GetCito Cloud, a write (POST, PUT, PATCH, DELETE) for an organization
 * whose plan isn't active answers 402 subscription_inactive, and on a plan
 * without MCP writes (Starter, a free trial) 402 plan_required, so a new
 * write route is gated without asking. The MCP endpoint, where every call is a
 * POST, passes `gateWrites: false` and gates its tools instead.
 */
export async function authenticateMcpRequest(
  req: Request,
  { gateWrites = true }: { gateWrites?: boolean } = {},
): Promise<McpAuthContext | NextResponse> {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

  if (!token || !token.startsWith(API_KEY_PREFIX)) {
    return NextResponse.json({ error: 'Missing or malformed API key' }, { status: 401 });
  }

  const hash = hashApiKey(token);

  const { data: key, error } = await supabaseAdmin
    .from('api_keys')
    .select('id, user_id, revoked_at')
    .eq('key_hash', hash)
    .maybeSingle();

  if (error || !key || key.revoked_at) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }

  // Resolve the owning user, their organization and the brands they may use, so handlers don't have to.
  let profile: Awaited<ReturnType<typeof readAccessProfile>>;
  let brandAccess: BrandAccess | null = null;
  try {
    profile = await readAccessProfile(key.user_id);
    if (profile?.organization_id) {
      brandAccess = await brandAccessOf(profile, key.user_id, profile.organization_id);
    }
  } catch (err) {
    console.error("[mcp-auth] Could not read the key owner's access:", err);
    return NextResponse.json({ error: 'Could not read access, try again' }, { status: 503 });
  }

  const organizationId = profile?.organization_id ?? null;
  if (gateWrites && WRITE_METHODS.has(req.method.toUpperCase())) {
    const access = await mcpWriteAccess(organizationId);
    if (access === 'inactive') return subscriptionInactiveResponse();
    if (access === 'plan') return planRequiredResponse();
  }

  // Best-effort touch — failing here shouldn't block the request.
  supabaseAdmin
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id)
    .then(() => {});

  const {
    data: { user },
  } = await supabaseAdmin.auth.admin.getUserById(key.user_id);

  return {
    userId: key.user_id,
    email: user?.email ?? null,
    organizationId,
    role: (profile?.role as UserRole | null | undefined) ?? null,
    apiKeyId: key.id,
    brandAccess,
  };
}
