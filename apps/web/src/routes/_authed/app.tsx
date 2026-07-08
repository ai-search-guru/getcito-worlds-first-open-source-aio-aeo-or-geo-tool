/**
 * /app layout route
 *
 * This is a passthrough layout for the /app section.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/app")({
	component: () => <Outlet />,
});
