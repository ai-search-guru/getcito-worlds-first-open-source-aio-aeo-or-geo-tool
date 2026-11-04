'use client';

import { useContext } from 'react';
import { RoleContext, type TeamRole } from '@/components/context/RoleProvider';

export interface UserRoleInfo {
  role: TeamRole;
  /** admin or manager — can write to prompts, brands, topics, etc. */
  canManage: boolean;
  /** admin only — can manage team members, API keys, billing, AI provider keys. */
  canAdmin: boolean;
}

/**
 * Read the current user's organizational role from `<RoleProvider>` and
 * project it into two derived flags the UI cares about. `canManage`
 * matches the admin-or-manager RLS gate used across `prompts`,
 * `prompt_sets`, `brand_domains`, `content_opportunities`, etc.;
 * `canAdmin` is the stricter admin-only gate used by team management
 * and Settings › AI Providers' keys.
 *
 * The plan-gating equivalent is [`useFeatureGate`](./useFeatureGate.ts).
 * They compose cleanly: feature gate decides "is this product surface
 * available at all?", role gate decides "is this user allowed to write?"
 */
export function useUserRole(): UserRoleInfo {
  const { role } = useContext(RoleContext);
  return {
    role,
    canManage: role === 'admin' || role === 'manager',
    canAdmin: role === 'admin',
  };
}
