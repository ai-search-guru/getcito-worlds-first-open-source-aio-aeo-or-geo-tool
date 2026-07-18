/**
 * Stories for the brand Overview page (/app/$brand). Renders the real
 * DashboardPage with mocked brand + dashboard/share-of-voice data so the page
 * can be viewed without auth or a database.
 */
import type { Meta, StoryObj } from "@storybook/react";
import type { ComponentType, ReactNode } from "react";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { Route } from "@/routes/_authed/app/$brand/index";

// The route file exports only `Route` (route files must, for code-splitting).
// Render its component via the route options — the mock exposes `options`.
const DashboardPage = (Route as unknown as { options: { component: ComponentType } }).options.component;
import { setMockBrand } from "./_mocks/use-brands";
import { setMockRouteContext } from "./_mocks/tanstack-router";
import { setMockDashboardSummary } from "./_mocks/server-dashboard";
import { setMockShareOfVoice } from "./_mocks/server-analysis";
import { mockDashboardSummary, mockShareOfVoice } from "./analytics-fixtures";

const onboardedBrand = {
	id: "brand-1",
	name: "Acme",
	website: "https://acme.com",
	onboarded: true,
	enabled: true,
	prompts: [{ id: "p1", value: "best crm", enabled: true }],
	effectiveModels: ["gpt-4o", "claude-3-5-sonnet", "gemini-1.5-pro"],
	earliestDataDate: "2026-05-05",
	delayOverrideHours: 24,
};

function Shell({ children }: { children: ReactNode }) {
	return (
		<TooltipProvider>
			<div className="bg-background text-foreground antialiased flex min-h-svh flex-col">
				<div className="flex flex-1 flex-col">
					<div className="@container/main flex flex-1 flex-col gap-2">
						<div className="flex flex-1 flex-col gap-4 p-4 md:gap-6 md:p-6">{children}</div>
					</div>
				</div>
			</div>
		</TooltipProvider>
	);
}

const meta = {
	title: "Pages/Overview",
	component: DashboardPage,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => {
			setMockBrand(onboardedBrand);
			setMockRouteContext({ clientConfig: { defaultDelayHours: 24 } });
			setMockDashboardSummary(mockDashboardSummary);
			setMockShareOfVoice(mockShareOfVoice);
			return (
				<Shell>
					<Story />
				</Shell>
			);
		},
	],
} satisfies Meta<typeof DashboardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
