import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
	IconDashboard,
	IconChartBar,
	IconSpeakerphone,
	IconSitemap,
	IconTarget,
	IconLink,
	IconBuilding,
	IconBuildings,
	IconListDetails,
	IconCpu,
	IconTable,
	IconReport,
	IconTimeline,
	IconTool,
} from "@tabler/icons-react";

import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
	useSidebar,
} from "@workspace/ui/components/sidebar";
import { NavMain, type NavGroup } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { NavAppInfo } from "@/components/nav-app-info";
import { DemoModePill } from "@/components/demo-mode-pill";
import { Logo } from "@/components/logo";
import type { BrandWithPrompts } from "@workspace/lib/db/schema";

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
	isAdmin?: boolean;
	hasReportAccess?: boolean;
	/** When true, only show admin section (no brand-specific nav) */
	adminOnly?: boolean;
	/** Brand data from route loader — avoids a separate client-side fetch */
	brand?: BrandWithPrompts | null;
}

export function AppSidebar({ isAdmin = false, hasReportAccess = false, adminOnly = false, brand, ...props }: AppSidebarProps) {
	const { setOpenMobile } = useSidebar();

	const showAdminSection = isAdmin || hasReportAccess;

	const groups: NavGroup[] = [];

	// Dashboard section - only show if we have a brand context and not admin-only
	if (!adminOnly) {
		const dashboardItems = [
			{
				title: "Overview",
				url: "/",
				icon: IconDashboard,
			},
		];

		// Only show Visibility and Citations if the brand is onboarded
		if (brand?.onboarded) {
			dashboardItems.push(
				{
					title: "Visibility",
					url: "/visibility",
					icon: IconChartBar,
				},
				{
					title: "Share of Voice",
					url: "/share-of-voice",
					icon: IconSpeakerphone,
				},
				{
					title: "Query Fan-Out",
					url: "/query-fan-out",
					icon: IconSitemap,
				},
				{
					title: "Citations",
					url: "/citations",
					icon: IconLink,
				},
				{
					title: "Opportunities",
					url: "/opportunities",
					icon: IconTarget,
				},
			);
		}

		groups.push({
			label: "Dashboard",
			items: dashboardItems,
		});

		// Settings section - always show so users can access brand settings or delete the brand
		groups.push({
			label: "Settings",
			items: [
				{
					title: "Brand",
					url: "/settings/brand",
					icon: IconBuilding,
				},
				{
					title: "Competitors",
					url: "/settings/competitors",
					icon: IconBuildings,
				},
				{
					title: "Prompts",
					url: "/settings/prompts",
					icon: IconListDetails,
				},
				{
					title: "LLMs",
					url: "/settings/llms",
					icon: IconCpu,
				},
			],
		});
	}

	// Admin section
	if (showAdminSection) {
		const adminItems = isAdmin
			? [
					{
						title: "Brands",
						url: "/admin",
						icon: IconTable,
						absolute: true,
					},
					{
						title: "Reports",
						url: "/reports",
						icon: IconReport,
						absolute: true,
					},
					{
						title: "Workflows",
						url: "/admin/workflows",
						icon: IconTimeline,
						absolute: true,
					},
					{
						title: "Tools",
						url: "/admin/tools",
						icon: IconTool,
						absolute: true,
					},
				]
			: [
					{
						title: "Reports",
						url: "/reports",
						icon: IconReport,
						absolute: true,
					},
				];

		groups.push({
			label: "Admin",
			items: adminItems,
		});
	}

	return (
		<Sidebar variant="inset" {...props}>
			<SidebarHeader>
				<SidebarMenu>
					<SidebarMenuItem>
					<SidebarMenuButton size="lg" asChild>
						<Link to="/app" onClick={() => setOpenMobile(false)}>
							<Logo iconClassName="!size-5" />
							<div className="ml-auto group-data-[collapsible=icon]:hidden">
								<DemoModePill />
							</div>
						</Link>
					</SidebarMenuButton>
					</SidebarMenuItem>
				</SidebarMenu>
			</SidebarHeader>
			<SidebarContent>
				<NavMain groups={groups} />
			</SidebarContent>
			<SidebarFooter>
				<NavUser />
				<NavAppInfo />
			</SidebarFooter>
		</Sidebar>
	);
}
