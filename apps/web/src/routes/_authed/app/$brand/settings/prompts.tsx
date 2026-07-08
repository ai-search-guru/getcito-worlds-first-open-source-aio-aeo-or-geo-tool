/**
 * /app/$brand/settings/prompts - Prompt management page
 *
 * Editor to add/edit/remove prompts.
 */
import { createFileRoute } from "@tanstack/react-router";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { prompts } from "@workspace/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { PromptsEditor } from "@/components/prompts-editor";
import { Skeleton } from "@workspace/ui/components/skeleton";

const getPromptsForEditing = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		// Fetch all prompts (including disabled) for editing
		const brandPrompts = await db
			.select()
			.from(prompts)
			.where(eq(prompts.brandId, data.brandId))
			.orderBy(desc(prompts.enabled), prompts.createdAt);

		return brandPrompts;
	});

function PromptsSettingsSkeleton() {
	return (
		<div className="space-y-4">
			<div className="space-y-2">
				<Skeleton className="h-9 w-48" />
				<Skeleton className="h-5 w-80" />
			</div>
			<div className="space-y-3">
				{[0, 1, 2, 3, 4].map((n) => (
					<div key={n} className="flex items-center gap-3 p-3 border rounded-lg">
						<Skeleton className="h-5 w-5" />
						<Skeleton className="h-5 flex-1" />
						<Skeleton className="h-8 w-20" />
					</div>
				))}
			</div>
		</div>
	);
}

export const Route = createFileRoute("/_authed/app/$brand/settings/prompts")({
	loader: async ({ params }) => {
		const brandPrompts = await getPromptsForEditing({ data: { brandId: params.brand } });
		return { prompts: brandPrompts };
	},
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Prompts", { appName, brandName }) },
				{ name: "description", content: "Add, edit, or remove tracked prompts." },
			],
		};
	},
	pendingComponent: PromptsSettingsSkeleton,
	component: PromptsSettingsPage,
});

function PromptsSettingsPage() {
	const { prompts: brandPrompts } = Route.useLoaderData();
	const { brand: brandId } = Route.useParams();

	return (
		<PromptsEditor
			initialPrompts={brandPrompts}
			brandId={brandId}
			pageTitle="Prompts"
			pageDescription="Add, edit, or remove your brand tracking keywords and prompts"
		/>
	);
}
