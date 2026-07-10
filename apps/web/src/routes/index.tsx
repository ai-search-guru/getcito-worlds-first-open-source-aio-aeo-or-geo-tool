/**
 * Home page - / route
 *
 * Redirects authenticated users to /app.
 * In demo mode, auto-redirects unauthenticated users to /auth/login
 * (the login page pre-fills the demo credentials, so the bare home page
 * is just a redundant extra click).
 * On a fresh deployment that needs bootstrapping (registration is open
 * AND no users exist yet), redirects to /auth/register so the first
 * visitor sees the signup screen instead of an empty-database login form.
 * Shows sign-in for unauthenticated users in other modes.
 */
import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "@/lib/auth/session";

export const Route = createFileRoute("/")({
	validateSearch: (search: Record<string, unknown>) => ({
		redirect: typeof search.redirect === "string" ? search.redirect : undefined,
	}),
	beforeLoad: async ({ context, search }) => {
		const session = await getSession();

		if (session) {
			throw redirect({ to: "/app" });
		}

		if (context.clientConfig?.canRegister && !context.clientConfig?.hasUsers) {
			throw redirect({
				to: "/auth/register",
				search: search.redirect ? { returnTo: search.redirect } : {},
			});
		}

		// Auto-redirect all other unauthenticated users to login
		// This skips the blank "Sign In" page and goes straight to SSO
		throw redirect({
			to: "/auth/login",
			search: search.redirect ? { returnTo: search.redirect } : {},
		});
	},
});
