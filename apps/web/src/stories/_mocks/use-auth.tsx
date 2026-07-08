/**
 * Mock for @/hooks/use-auth — provides controllable auth state for stories.
 */

let _mockAuth = {
	user: {
		name: "Demo User",
		email: "demo@example.com",
		picture: "",
		given_name: "Demo",
		family_name: "User",
	} as any,
	isLoading: false,
	isAuthenticated: true,
	loginUrl: "/auth/login" as string | undefined,
	logoutUrl: "/auth/logout" as string | undefined,
};

export function setMockAuth(auth: Partial<typeof _mockAuth>) {
	_mockAuth = { ..._mockAuth, ...auth };
}

export function useAuth() {
	return _mockAuth;
}
