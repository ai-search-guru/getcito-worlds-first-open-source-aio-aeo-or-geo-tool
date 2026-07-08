import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/app/$brand/prompts/")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/app/$brand/visibility",
			params: { brand: params.brand },
		});
	},
});
