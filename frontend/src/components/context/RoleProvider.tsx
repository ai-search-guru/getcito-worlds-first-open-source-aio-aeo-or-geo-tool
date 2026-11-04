'use client';

import { createContext, type ReactNode } from 'react';

/**
 * Source of truth for the four roles `profiles.role` can hold. Kept here
 * (next to the provider) so client components can import the type without
 * pulling the `'use server'` boundary in `lib/actions/team.ts`.
 *
 * The DB-side RLS policies grant **write** access to `admin | manager` on
 * the major resource tables (`prompts`, `prompt_sets`, `brands`,
 * `brand_domains`, `content_opportunities`). `analyst` and `agency_partner`
 * are read-only at the database layer — the UI mirrors that posture via
 * `useUserRole().canManage` + `<RoleGate>`.
 */
export type TeamRole = 'admin' | 'manager' | 'analyst' | 'agency_partner';

export interface RoleContextValue {
  role: TeamRole;
}

// Default to the lowest-privilege role so a misconfigured tree fails safe
// — write controls stay hidden if the provider didn't mount.
export const RoleContext = createContext<RoleContextValue>({ role: 'analyst' });

export function RoleProvider({ role, children }: { role: TeamRole; children: ReactNode }) {
  return <RoleContext.Provider value={{ role }}>{children}</RoleContext.Provider>;
}
