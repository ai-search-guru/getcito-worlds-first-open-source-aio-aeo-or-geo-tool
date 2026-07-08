/**
 * Access control definitions for the application.
 *
 * Uses better-auth's built-in access control system to define resources,
 * actions, and role-based permission grants. Shared across all deployment modes.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements, adminAc } from "better-auth/plugins/admin/access";

export const statement = {
	...defaultStatements,
	brand: ["read", "create", "update", "delete"],
	report: ["generate"],
} as const;

export const ac = createAccessControl(statement);

export const adminRole = ac.newRole({
	brand: ["read", "create", "update", "delete"],
	report: ["generate"],
	...adminAc.statements,
});

export const userRole = ac.newRole({
	brand: ["read"],
});
