'use client';

import { useUserRole } from '@/hooks/useUserRole';
import type { TeamRole } from '@/components/context/RoleProvider';

/**
 * Conditionally render children based on the current user's role.
 *
 * Tiny wrapper on top of {@link useUserRole}; sugar for cases where you'd
 * otherwise sprinkle `if (!canManage) return null` around several pieces
 * of JSX in the same component.
 *
 * ```tsx
 * <RoleGate roles={['admin', 'manager']}>
 *   <Button onClick={handleSave}>Save</Button>
 * </RoleGate>
 *
 * <RoleGate
 *   roles={['admin', 'manager']}
 *   fallback={<p className="text-sm">Ask an admin to edit this.</p>}
 * >
 *   <EditForm />
 * </RoleGate>
 * ```
 */
export function RoleGate({
  roles,
  fallback = null,
  children,
}: {
  roles: TeamRole[];
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const { role } = useUserRole();
  return roles.includes(role) ? <>{children}</> : <>{fallback}</>;
}
