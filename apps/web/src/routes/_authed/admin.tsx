/**
 * /admin layout - Admin section with access control
 *
 * Checks admin status; returns 404 if not admin.
 * Wraps admin routes with admin-specific sidebar.
 */
import { createFileRoute, Outlet, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthSession, isAdmin, hasReportAccess } from "@/lib/auth/helpers";
import { SidebarInset, SidebarProvider } from "@workspace/ui/components/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";

const checkAdminAccess = createServerFn({ method: "GET" }).handler(async (): Promise<{
	isAdmin: boolean;
	hasReportAccess: boolean;
}> => {
	const session = await requireAuthSession();
	return {
		isAdmin: isAdmin(session),
		hasReportAccess: hasReportAccess(session),
	};
});

export const Route = createFileRoute("/_authed/admin")({
	beforeLoad: async () => {
		const { isAdmin, hasReportAccess } = await checkAdminAccess();

		if (!isAdmin) {
			throw notFound();
		}

		return { isAdmin, hasReportAccess };
	},
	component: AdminLayout,
});

function AdminLayout() {
	const { isAdmin, hasReportAccess } = Route.useRouteContext();

	return (
		<SidebarProvider>
			<AppSidebar isAdmin={isAdmin} hasReportAccess={hasReportAccess} adminOnly />
			<SidebarInset className="md:border md:border-border/60 md:rounded-xl overflow-hidden">
				<SiteHeader />
				<div className="flex flex-1 flex-col">
					<div className="@container/main flex flex-1 flex-col gap-2">
						<div className="flex flex-col gap-4 p-4 md:gap-6 md:p-6">
							<Outlet />
						</div>
					</div>
				</div>
			</SidebarInset>
		</SidebarProvider>
	);
}
