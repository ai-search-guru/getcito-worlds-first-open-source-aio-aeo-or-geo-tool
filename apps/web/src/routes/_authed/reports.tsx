/**
 * /reports layout route
 *
 * Passthrough layout for the /reports section.
 * Access control is handled at the page level.
 */
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/reports")({
	component: () => <Outlet />,
});
