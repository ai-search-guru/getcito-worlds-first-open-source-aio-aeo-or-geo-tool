import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/app/$brand/settings/")({
	beforeLoad: ({ params }) => {
		throw redirect({
			to: "/app/$brand/settings/brand",
			params: { brand: params.brand },
		});
	},
});
