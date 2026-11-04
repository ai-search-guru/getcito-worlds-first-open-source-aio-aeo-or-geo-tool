import { NextResponse } from 'next/server';
import type { McpAuthContext } from '@/lib/mcpAuth';
import type { UserRole } from '@/types';

/**
 * Who may do what over an API key. The key acts as its user, with that
 * user's role, and the MCP layer writes with the service role, so the row
 * rules the dashboard relies on don't apply: the tools check the role
 * themselves. The split follows the dashboard: day-to-day work (drafts,
 * tasks, audits, briefs, reports) is open to every member; adding prompts or
 * topics, dismissing what the team decides on, and settings are for admins
 * and managers.
 */
export const MANAGER_ROLES = ['admin', 'manager'] as const satisfies readonly UserRole[];

/** Everyone but an agency partner, as prompt_suggestions' update rule (00048). */
export const MEMBER_ROLES = ['admin', 'manager', 'analyst'] as const satisfies readonly UserRole[];

const ROLE_NAMES: Record<UserRole, string> = {
  admin: 'an admin',
  manager: 'a manager',
  analyst: 'an analyst',
  agency_partner: 'an agency partner',
};

/** "an admin or a manager", "an admin, a manager or an analyst". */
function roleList(roles: readonly UserRole[]): string {
  const names = roles.map((role) => ROLE_NAMES[role]);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names.at(-1)}` : names[0];
}

/**
 * A call the key's user may not make with their role. An MCP tool that throws
 * it answers as a tool error with the message (the SDK turns a thrown error
 * into one); a REST route answers 403 (roleRequiredResponse).
 */
export class RoleRequiredError extends Error {
  readonly status = 403;
  readonly code = 'role_required';

  constructor(roles: readonly UserRole[], role: UserRole | null) {
    super(
      `Only ${roleList(roles)} can do this. This API key acts as ${
        role ? ROLE_NAMES[role] : 'a user without a role'
      }: ask an admin or a manager of the organization to do it.`,
    );
    this.name = 'RoleRequiredError';
  }
}

/** Refuse the call unless the key's user has one of `roles`. */
export function requireRole(auth: Pick<McpAuthContext, 'role'>, roles: readonly UserRole[]): void {
  if (!auth.role || !roles.includes(auth.role)) throw new RoleRequiredError(roles, auth.role);
}

/** Refuse the call unless the key's user is an admin or a manager. */
export function requireManager(auth: Pick<McpAuthContext, 'role'>): void {
  requireRole(auth, MANAGER_ROLES);
}

/** The REST routes' answer to a call refused for the role. */
export function roleRequiredResponse(err: RoleRequiredError): NextResponse {
  return NextResponse.json(
    { error: 'forbidden', code: err.code, message: err.message },
    { status: 403 },
  );
}
