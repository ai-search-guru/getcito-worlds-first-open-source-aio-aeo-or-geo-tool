/**
 * /app/$brand/share-of-voice - Share of Voice
 *
 * "Who do the AI engines mention instead of you?" A leaderboard of competitor
 * mention rates next to the brand's own, with the brand's overall share, a
 * donut of top competitors, and share of voice over time.
 */
import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Badge } from "@workspace/ui/components/badge";
import { shareOfVoiceColorMap } from "@/lib/share-of-voice-palette";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/components/table";
import { TooltipProvider } from "@workspace/ui/components/tooltip";
import { getAppName, getBrandName, buildTitle } from "@/lib/route-head";
import { useShareOfVoice } from "@/hooks/use-share-of-voice";
import { usePromptsSummary } from "@/hooks/use-prompts-summary";
import { useBrand, useCompetitors } from "@/hooks/use-brands";
import { PageHeader, FilterSection } from "@/components/page-header";
import { FilterBar, getAvailableModels, ALL_MODELS_VALUE } from "@/components/filter-bar";
import { useListFilters } from "@/hooks/use-list-filters";
import { ColHead } from "@/components/col-head";
import { ShareOfVoiceDonut } from "@/components/share-of-voice-donut";
import { TrendChart } from "@/components/trend-chart";
import { WebLogo } from "@/components/web-logo";

export const Route = createFileRoute("/_authed/app/$brand/share-of-voice")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Share of Voice", { appName, brandName }) },
				{ name: "description", content: "See how often AI engines mention you versus your competitors." },
			],
		};
	},
	component: ShareOfVoicePage,
});

const formatPct = (share: number) => `${Math.round(share * 100)}%`;

/** Latest non-null point of the share-of-voice trend — the value the line ends on. */
function currentShareOf(series: Array<{ share: number | null }>): number | null {
	for (let i = series.length - 1; i >= 0; i--) {
		const v = series[i]?.share;
		if (typeof v === "number") return v;
	}
	return null;
}

const TIPS = {
	mentions: "Number of runs in which this brand was mentioned in the AI answer.",
	share: "This brand's share of all brand + competitor mentions.",
	prompts: "Number of distinct prompts this brand appeared in.",
};

function ShareOfVoicePage() {
	const { brand: brandId } = Route.useParams();
	const { model, lookback, tags } = useListFilters();

	const { brand } = useBrand(brandId);
	const { competitors } = useCompetitors(brandId);

	const getDomain = (name: string) => {
		if (name === brand?.name) return brand?.website;
		return competitors?.find((c) => c.name === name)?.domains?.[0];
	};

	const availableModels = getAvailableModels(brand?.effectiveModels ?? []);
	const modelParam = model === ALL_MODELS_VALUE ? undefined : model;

	const { promptsSummary } = usePromptsSummary(brandId, { lookback, model: modelParam });
	const availableTags = promptsSummary?.availableTags ?? [];

	const { data, isLoading } = useShareOfVoice(brandId, { lookback, model: modelParam, tags });

	const infoContent = (
		<>
			<p className="mb-2">
				Share of voice is how often each brand is mentioned in the AI answers to your prompts. Mentions are counted
				per run, so the brand and competitor figures use the same unit and are directly comparable.
			</p>
			<p>Competitors are the ones you track in settings. Switch the model filter to compare engines.</p>
		</>
	);

	const maxMentions = data?.entries.reduce((m, e) => Math.max(m, e.mentions), 0) ?? 0;
	const barColors = shareOfVoiceColorMap(data?.entries ?? []);

	let content: React.ReactNode;
	if (isLoading && !data) {
		content = (
			<Card>
				<CardHeader>
					<Skeleton className="h-6 w-48" />
				</CardHeader>
				<CardContent className="space-y-4">
					<Skeleton className="h-4 w-3/4" />
					<Skeleton className="h-4 w-2/3" />
					<Skeleton className="h-4 w-1/2" />
				</CardContent>
			</Card>
		);
	} else if (!data || data.totalRuns === 0 || data.entries.length === 0) {
		content = (
			<Card>
				<CardContent className="pt-6">
					<div className="text-muted-foreground text-center py-8">
						No mention data yet for the selected filters. Mentions appear once your prompts have been run.
					</div>
				</CardContent>
			</Card>
		);
	} else {
		// The big number = the trend's last plotted point, so it matches the line beside it.
		const currentShare = currentShareOf(data.shareTimeSeries);
		content = (
			<TooltipProvider delayDuration={150}>
				<div className="grid gap-6 lg:grid-cols-2">
					<Card>
						<CardHeader>
							<CardTitle>Share of Voice</CardTitle>
						</CardHeader>
						<CardContent className="flex items-center justify-between gap-4">
							<div>
								<div className="text-3xl sm:text-4xl font-bold tabular-nums">
									{currentShare !== null ? `${currentShare}%` : "—"}
								</div>
								<p className="text-sm text-muted-foreground mt-1 max-w-[18rem]">
									{data.brandName} across {data.totalRuns.toLocaleString()} runs
									{data.entries.length > 1 ? ` and ${data.entries.length - 1} competitors` : ""}.
								</p>
							</div>
							<ShareOfVoiceDonut entries={data.entries} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Share of Voice Trends</CardTitle>
						</CardHeader>
						<CardContent>
							<TrendChart
								data={data.shareTimeSeries.map((p) => ({ date: p.date, value: p.share }))}
								label="Share of Voice"
								color="#2563eb"
								className="aspect-auto h-[180px] w-full"
							/>
						</CardContent>
					</Card>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>Share of Voice Leaderboard</CardTitle>
					</CardHeader>
					<CardContent>
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10">#</TableHead>
									<TableHead>Brand</TableHead>
									<TableHead className="text-right">
										<ColHead label="Mentions" tip={TIPS.mentions} right />
									</TableHead>
									<TableHead className="w-[34%]">
										<ColHead label="Share" tip={TIPS.share} />
									</TableHead>
									<TableHead className="text-right">
										<ColHead label="Prompts" tip={TIPS.prompts} right />
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{data.entries.map((e, i) => {
									const domain = getDomain(e.name);
									return (
										<TableRow key={e.name} className={e.isBrand ? "bg-muted/40" : undefined}>
											<TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
											<TableCell className="font-medium">
												<span className="inline-flex items-center gap-2">
													{domain && <WebLogo domain={domain} size={20} />}
													{e.name}
													{e.isBrand && (
														<Badge variant="secondary" className="text-xs">
															You
														</Badge>
													)}
												</span>
											</TableCell>
											<TableCell className="text-right tabular-nums">{e.mentions.toLocaleString()}</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												<div className="bg-muted h-2 w-full overflow-hidden rounded-full">
													<div
														className="h-full rounded-full"
														style={{
															width: `${maxMentions > 0 ? (e.mentions / maxMentions) * 100 : 0}%`,
															backgroundColor: barColors.get(e.name) ?? "#cbd5e1",
														}}
													/>
												</div>
												<span className="tabular-nums text-sm text-muted-foreground w-10 text-right">
													{formatPct(e.share)}
												</span>
											</div>
										</TableCell>
										<TableCell className="text-right tabular-nums text-muted-foreground">{e.prompts}</TableCell>
									</TableRow>
								);
								})}
							</TableBody>
						</Table>
					</CardContent>
				</Card>
			</TooltipProvider>
		);
	}

	return (
		<PageHeader
			title="Share of Voice"
			subtitle="How often AI engines mention you versus your competitors."
			infoContent={infoContent}
		>
			<FilterSection>
				<FilterBar availableTags={availableTags} availableModels={availableModels} showSearch={false} showModelSelector />
			</FilterSection>
			<div className="space-y-6">{content}</div>
		</PageHeader>
	);
}
