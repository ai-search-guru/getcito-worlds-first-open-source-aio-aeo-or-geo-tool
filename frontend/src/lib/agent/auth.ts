import { createClient } from '@/lib/supabase/server';
import { brandAccessOf, readAccessProfile } from '@/lib/brandAccess';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { UserRole } from '@/types';

/**
 * Resolve the current dashboard session into the same shape the MCP data
 * layer expects (`McpAuthContext`). The agent's tools are the MCP read
 * functions called directly as JS — bypassing the MCP transport — so they
 * need the same auth context the MCP layer relies on for org scoping.
 *
 * Returns `null` when the user isn't signed in or doesn't have a profile
 * row pinning them to an organization.
 */
export async function resolveAgentAuth(): Promise<McpAuthContext | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const profile = await readAccessProfile(user.id);
  if (!profile?.organization_id) return null;

  return {
    userId: user.id,
    email: user.email ?? '',
    organizationId: profile.organization_id,
    role: (profile.role as UserRole | null | undefined) ?? null,
    // The MCP-auth shape expects an apiKeyId — the agent isn't behind an
    // API key, this is just a marker so downstream code that switches on
    // the field knows the call came from the in-product agent rather than
    // an external MCP client.
    apiKeyId: 'agent-internal',
    // The brands they may use (BRAND-ACCESS §5.3), read once for this request's tools.
    brandAccess: await brandAccessOf(profile, user.id, profile.organization_id),
  };
}
