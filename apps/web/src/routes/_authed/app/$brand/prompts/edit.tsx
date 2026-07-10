import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/app/$brand/prompts/edit")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/app/$brand/settings/prompts",
			params: { brand: params.brand },
		});
	},
});
