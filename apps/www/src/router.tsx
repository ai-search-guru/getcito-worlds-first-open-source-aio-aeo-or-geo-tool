import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { NotFound } from "./components/not-found";

export function getRouter() {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultNotFoundComponent: NotFound,
	});

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
