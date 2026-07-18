/**
 * Mock for @tanstack/react-start (and /server subpath) used in Storybook
 * stories. Stubs out server-only APIs (createServerFn, createMiddleware,
 * getRequestHeaders, etc.) so components that transitively import them can
 * still bundle and render.
 */

type ServerFnBuilder = {
	validator: (..._args: unknown[]) => ServerFnBuilder;
	middleware: (..._args: unknown[]) => ServerFnBuilder;
	handler: (..._args: unknown[]) => () => Promise<unknown>;
};

const serverFnBuilder = (): ServerFnBuilder => ({
	validator: () => serverFnBuilder(),
	middleware: () => serverFnBuilder(),
	handler: () => () => Promise.resolve(undefined),
});

export const createServerFn = (..._args: unknown[]) => serverFnBuilder();

type MiddlewareBuilder = {
	server: (..._args: unknown[]) => MiddlewareBuilder;
	client: (..._args: unknown[]) => MiddlewareBuilder;
};

const middlewareBuilder = (): MiddlewareBuilder => ({
	server: () => middlewareBuilder(),
	client: () => middlewareBuilder(),
});

export const createMiddleware = (..._args: unknown[]) => middlewareBuilder();

export const createStart = (..._args: unknown[]) => ({
	createMiddleware: () => middlewareBuilder(),
});

export const getRequestHeaders = () => ({});

export const getRequest = () => ({ headers: new Headers() });

export default {};
