/**
 * /auth/login - Login page
 *
 * Local/cloud modes: email/password form.
 * Whitelabel mode: auto-redirects to Auth0 SSO (no form shown).
 */

import { IconInfoCircle } from "@tabler/icons-react";
import { createFileRoute, Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { authClient } from "@workspace/lib/auth/client";
import { Alert, AlertDescription } from "@workspace/ui/components/alert";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { useEffect, useState } from "react";
import { z } from "zod";
import FullPageCard from "@/components/full-page-card";

export const Route = createFileRoute("/auth/login")({
	validateSearch: z.object({
		returnTo: z.string().optional(),
	}),
	component: LoginPage,
});

/** Reject cross-origin returnTo values to prevent open redirects. */
function safeReturnTo(returnTo: string | undefined): string {
	if (!returnTo) return "/app";
	if (returnTo.startsWith("/") && !returnTo.startsWith("//")) return returnTo;
	try {
		const url = new URL(returnTo, window.location.origin);
		if (url.origin !== window.location.origin) return "/app";
		return `${url.pathname}${url.search}${url.hash}`;
	} catch {
		return "/app";
	}
}

function LoginPage() {
	const { returnTo } = Route.useSearch();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const mode = context.clientConfig?.mode;
	const canRegister = context.clientConfig?.canRegister ?? false;

	if (mode === "whitelabel") {
		return <SSOLogin returnTo={returnTo} />;
	}

	return <EmailPasswordLogin returnTo={returnTo} isDemo={mode === "demo"} canRegister={canRegister} />;
}

function SSOLogin({ returnTo }: { returnTo?: string }) {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		authClient.signIn
			.sso({ providerId: "auth0-whitelabel", callbackURL: safeReturnTo(returnTo) })
			.then((result) => {
				if (cancelled) return;
				if (result.error) {
					setError(result.error.message ?? "Failed to start sign-in");
				}
			})
			.catch(() => {
				if (!cancelled) {
					setError("Something went wrong. Please try again.");
				}
			});

		return () => {
			cancelled = true;
		};
	}, [returnTo]);

	if (error) {
		return (
			<FullPageCard title="Sign in">
				<Alert variant="destructive">
					<AlertDescription>{error}</AlertDescription>
				</Alert>
				<Button className="w-full" onClick={() => window.location.reload()}>
					Try Again
				</Button>
			</FullPageCard>
		);
	}

	return <FullPageCard title="Signing in..." subtitle="Redirecting to your identity provider" />;
}

export function EmailPasswordLogin({
	returnTo,
	isDemo,
	canRegister,
}: {
	returnTo?: string;
	isDemo?: boolean;
	canRegister?: boolean;
}) {
	const navigate = useNavigate();
	const [email, setEmail] = useState(isDemo ? "demo@Getcitohq.com" : "");
	const [password, setPassword] = useState(isDemo ? "demo" : "");
	const [error, setError] = useState<string | null>(null);
	const [loading, setLoading] = useState(false);

	async function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		setError(null);
		setLoading(true);

		try {
			const result = await authClient.signIn.email({
				email,
				password,
			});

			if (result.error) {
				setError(result.error.message ?? "Invalid email or password");
				setLoading(false);
				return;
			}

			navigate({ to: safeReturnTo(returnTo) });
		} catch {
			setError("Something went wrong. Please try again.");
			setLoading(false);
		}
	}

	return (
		<FullPageCard title="Sign in" subtitle={isDemo ? undefined : "Enter your email and password to continue"}>
			<form onSubmit={handleSubmit} className="space-y-4 w-full">
				{isDemo && <DemoCredentialsCallout />}
				{error && (
					<Alert variant="destructive">
						<AlertDescription>{error}</AlertDescription>
					</Alert>
				)}
				{!isDemo && (
					<>
						<div className="space-y-2">
							<Label htmlFor="email">Email</Label>
							<Input
								id="email"
								type="email"
								placeholder="you@example.com"
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								required
								autoComplete="email"
								autoFocus
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="password">Password</Label>
							<Input
								id="password"
								type="password"
								placeholder="Password"
								value={password}
								onChange={(e) => setPassword(e.target.value)}
								required
								autoComplete="current-password"
							/>
						</div>
					</>
				)}
				<Button type="submit" className="w-full" disabled={loading}>
					{loading ? "Signing in..." : "Sign in"}
				</Button>
			</form>
			{canRegister && (
				<p className="text-center text-sm text-muted-foreground pt-4">
					Don't have an account?{" "}
					<Link
						to="/auth/register"
						search={returnTo ? { returnTo } : {}}
						className="text-primary hover:underline font-medium"
					>
						Create one
					</Link>
				</p>
			)}
		</FullPageCard>
	);
}

function DemoCredentialsCallout() {
	return (
		<div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
			<IconInfoCircle className="mt-0.5 size-5 shrink-0 text-amber-600 dark:text-amber-400" />
			<div className="space-y-2">
				<p className="font-medium text-amber-900 dark:text-amber-100">Demo Account</p>
				<dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-amber-900/90 dark:text-amber-100/80">
					<div className="flex items-center gap-1.5">
						<dt className="opacity-70">Email</dt>
						<dd className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px]">demo@Getcitohq.com</dd>
					</div>
					<div className="flex items-center gap-1.5">
						<dt className="opacity-70">Password</dt>
						<dd className="rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-[11px]">demo</dd>
					</div>
				</dl>
			</div>
		</div>
	);
}
