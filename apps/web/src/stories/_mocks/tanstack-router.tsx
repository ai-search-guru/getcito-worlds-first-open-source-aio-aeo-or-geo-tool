/**
 * Mock for @tanstack/react-router used in Storybook stories.
 * Provides stubs for the router hooks and components that the app uses.
 */
import React, { createContext, useContext, type ReactNode } from "react";

// This mock is used for Storybook bundling. It intentionally provides a broad
// surface-area of exports to satisfy app imports without pulling in a real router.

// ---------------------------------------------------------------------------
// Settable route context — stories call setMockRouteContext() before rendering
// ---------------------------------------------------------------------------

const RouteCtx = createContext<Record<string, unknown>>({});

let _routeContext: Record<string, unknown> = {};

export function setMockRouteContext(ctx: Record<string, unknown>) {
	_routeContext = ctx;
}

/**
 * Wraps story content so that useRouteContext returns the provided value.
 */
export function MockRouteContextProvider({
	value,
	children,
}: {
	value: Record<string, unknown>;
	children: ReactNode;
}) {
	return <RouteCtx.Provider value={value}>{children}</RouteCtx.Provider>;
}

// ---------------------------------------------------------------------------
// Stubs for @tanstack/react-router exports used by app components
// ---------------------------------------------------------------------------

export function useRouteContext(_opts?: unknown) {
	const ctx = useContext(RouteCtx);
	// Merge with module-level context so both approaches work
	return { ..._routeContext, ...ctx };
}

export function createRouter(_opts?: unknown) {
	return {
		state: { location: { pathname: "/", search: "", hash: "" } },
		navigate: (_next: unknown) => {},
	};
}

export function createFileRoute(_path: string) {
	return (config: any) => ({
		...config,
		// Mirror the real Route shape so stories can render a route's component via
		// Route.options.component (without the route file having to export it).
		options: config,
		useParams: () => ({ brand: "mock-brand-id" }),
		useSearch,
		useNavigate,
	});
}

export function createRootRouteWithContext<TContext>() {
	return (_opts: any) => {
		// Root route component isn't needed in stories; only exports must exist.
		return {} as any as TContext;
	};
}

export function useParams(_opts?: unknown) {
	return { brand: "mock-brand-id" };
}

export function useNavigate() {
	return (_opts: unknown) => {
		/* noop */
	};
}

export function useLocation() {
	return { pathname: "/app/mock-brand-id", search: "", hash: "" };
}

// Stories render with an empty search (all filters at defaults). Honor
// `select` so per-key subscribers (filter-bar widgets) get `undefined`
// instead of the whole empty object.
export function useSearch(opts?: { select?: (search: Record<string, unknown>) => unknown }) {
	const search: Record<string, unknown> = {};
	return opts?.select ? opts.select(search) : search;
}

export function useMatch(_opts?: unknown) {
	return { params: { brand: "mock-brand-id" } };
}

export function useRouter() {
	return {
		navigate: (_opts: unknown) => {},
		state: { location: { pathname: "/", search: "", hash: "" } },
	};
}

export function isRedirect(_error: unknown): _error is never {
	return false;
}

export function redirect(_opts: unknown): never {
	throw new Error("redirect() called in Storybook mock");
}

export function notFound(_opts?: unknown): never {
	throw new Error("notFound() called in Storybook mock");
}

export function RouterProvider(_props: { router: unknown }) {
	return null;
}

export function Outlet() {
	return null;
}

export function Scripts() {
	return null;
}

export function ScriptOnce(_props: { children?: unknown }) {
	return null;
}

export function HeadContent() {
	return null;
}

export function Await(_props: any) {
	return null;
}

export function lazyRouteComponent(loader: any) {
	// In real TanStack Router this returns a lazy component; for stories we can
	// just return a function component that renders nothing.
	// Some code paths may call the loader eagerly; guard it.
	return function LazyRouteComponentMock(_props: any) {
		if (typeof loader === "function") {
			try {
				void loader();
			} catch {
				// ignore
			}
		}
		return null;
	};
}

export const Link = React.forwardRef<HTMLButtonElement, any>(function LinkMock(
	{ to, children, onClick, ...props },
	ref,
) {
	return (
		<button
			type="button"
			ref={ref}
			onClick={onClick}
			{...props}
		>
			{children}
		</button>
	);
});
