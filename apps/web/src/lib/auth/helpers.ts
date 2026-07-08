/**
 * Server-side auth helpers backed by better-auth.
 */
import { getRequestHeaders } from "@tanstack/react-start/server";
import { db } from "@workspace/lib/db/db";
import { member, organization, user, brands } from "@workspace/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "./server";

type SessionLike = { user: { id: string; [key: string]: unknown }; session?: unknown };

export async function getAuthSession() {
	const headers = getRequestHeaders();
	return auth.api.getSession({ headers });
}

export async function requireAuthSession() {
	const session = await getAuthSession();
	if (!session) throw new Error("Unauthorized: Authentication required");
	return session;
}

export function isAdmin(session: SessionLike): boolean {
	return session.user.role === "admin";
}

export function hasReportAccess(session: SessionLike): boolean {
	return session.user.hasReportGeneratorAccess === true;
}

export async function checkOrgAccess(userId: string, orgId: string): Promise<boolean> {
	const [userRow] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (userRow?.role === "admin") {
		return true; // Admins automatically have access to all brands
	}

	const [row] = await db
		.select({ id: member.id })
		.from(member)
		.where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
		.limit(1);
	return !!row;
}

export async function requireOrgAccess(userId: string, orgId: string): Promise<void> {
	if (!(await checkOrgAccess(userId, orgId))) {
		throw new Error("Forbidden: No access to this organization");
	}
}

export async function listUserOrganizations(
	userId: string,
): Promise<{ id: string; name: string; targetMarket?: string | null; author?: string | null }[]> {
	const [userRow] = await db
		.select({ role: user.role })
		.from(user)
		.where(eq(user.id, userId))
		.limit(1);

	if (userRow?.role === "admin") {
		// Admins can see all organizations in the switcher, plus target market and author
		// Since Auth0 synced users are assigned "member" role, we fetch the earliest member (creator).
		const firstMembers = db
			.selectDistinctOn([member.organizationId], {
				organizationId: member.organizationId,
				userId: member.userId,
			})
			.from(member)
			.orderBy(member.organizationId, member.createdAt)
			.as("first_members");

		return db
			.select({
				id: organization.id,
				name: organization.name,
				targetMarket: brands.targetMarket,
				author: user.name,
			})
			.from(organization)
			.leftJoin(brands, eq(organization.id, brands.id))
			.leftJoin(firstMembers, eq(firstMembers.organizationId, organization.id))
			.leftJoin(user, eq(firstMembers.userId, user.id))
			.orderBy(organization.name);
	}

	// For normal users, just show their orgs and target markets (they are the members themselves, author not as strictly needed but we can omit)
	return db
		.select({
			id: organization.id,
			name: organization.name,
			targetMarket: brands.targetMarket,
		})
		.from(member)
		.innerJoin(organization, eq(member.organizationId, organization.id))
		.leftJoin(brands, eq(organization.id, brands.id))
		.where(eq(member.userId, userId))
		.orderBy(organization.name);
}
