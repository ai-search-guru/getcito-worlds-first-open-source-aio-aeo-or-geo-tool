import * as Sentry from "@sentry/tanstackstart-react";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import * as TanstackQuery from "./integrations/tanstack-query/root-provider";
import { routeTree } from "./routeTree.gen";
import { DefaultErrorComponent, DefaultPendingComponent, NotFound } from "./router-default-components";

export const getRouter = () => {
	const rqContext = TanstackQuery.getContext();

	const router = createRouter({
		routeTree,
		context: {
			...rqContext,
			// clientConfig is provided by __root.tsx's beforeLoad
			clientConfig: undefined!,
			// envValidation is provided by __root.tsx's beforeLoad
			envValidation: undefined!,
		},
		defaultPreload: "intent",
		defaultNotFoundComponent: NotFound,
		defaultErrorComponent: DefaultErrorComponent,
		defaultPendingComponent: DefaultPendingComponent,
		defaultPendingMs: 0,
		defaultPendingMinMs: 200,
		defaultStaleTime: 30_000, // Cache loader data for 30s to avoid re-fetching on navigations
	});

	if (!router.isServer && import.meta.env.VITE_SENTRY_DSN) {
		Sentry.init({
			dsn: import.meta.env.VITE_SENTRY_DSN,
			environment: import.meta.env.MODE,
			sendDefaultPii: true,
			integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
			tracesSampleRate: 1.0,
		});
	}

	setupRouterSsrQueryIntegration({ router, queryClient: rqContext.queryClient });

	return router;
};
