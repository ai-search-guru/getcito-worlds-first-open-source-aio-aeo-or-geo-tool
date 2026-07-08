/**
 * Auth hook for TanStack Start.
 *
 * Reads the session from route context (set by _authed layout).
 */
import { useRouteContext } from "@tanstack/react-router";

export interface AuthUser {
	id: string;
	name?: string;
	email?: string;
	picture?: string;
	given_name?: string;
	family_name?: string;
}

export interface UseAuthResult {
	user: AuthUser | null;
	isLoading: boolean;
	isAuthenticated: boolean;
	loginUrl: string;
	logoutUrl: string;
}

/**
 * Get current user across different auth providers.
 * Session is loaded server-side in _authed layout's beforeLoad.
 */
export function useAuth(): UseAuthResult {
	const context = useRouteContext({ strict: false }) as {
		session?: {
			user: { id: string; name?: string; email?: string; image?: string | null };
		} | null;
	};
	const session = context.session;
	return {
		user: session?.user
			? {
					id: session.user.id,
					name: session.user.name,
					email: session.user.email,
					picture: session.user.image ?? undefined,
				}
			: null,
		isLoading: false,
		isAuthenticated: !!session?.user,
		loginUrl: "/auth/login",
		logoutUrl: "/auth/logout",
	};
}
