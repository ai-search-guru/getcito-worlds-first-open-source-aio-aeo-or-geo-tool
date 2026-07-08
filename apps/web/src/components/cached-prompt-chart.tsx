
import { memo, useMemo, useCallback } from "react";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Badge } from "@workspace/ui/components/badge";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { BaseChart } from "./base-chart";
import { ChartActionsFooter } from "./chart-actions-footer";
import { TextHighlighter } from "./text-highlighter";
import { useChartExport } from "@/hooks/use-chart-export";
import { useOptionalChartDataContext } from "@/contexts/chart-data-context";
import type { LookbackPeriod } from "@/hooks/use-prompt-chart-data";
import {
	getBadgeVariant,
	getBadgeClassName,
} from "@/lib/chart-utils";

const PLACEHOLDER_BARS_NO_DATA = [20, 35, 15, 45, 25, 40, 30, 50, 20, 35, 45, 28].map(
	(h, i) => ({ key: String(i), h }),
);
const PLACEHOLDER_BARS_NO_VISIBILITY = [10, 15, 8, 12, 10, 14, 8, 12, 10, 15, 12, 9].map(
	(h, i) => ({ key: String(i), h }),
);

function PromptTitle({ name, highlight }: { name: string; highlight: string }) {
	return (
		<CardTitle className="text-sm">
			<TextHighlighter text={name} highlight={highlight} />
		</CardTitle>
	);
}

export interface CachedPromptChartProps {
	promptId: string;
	promptName: string;
	brandId: string;
	lookback: LookbackPeriod;
	/** Current model filter from the URL. "all" = no filter. */
	selectedModel?: string;
	/** Concrete model ids this brand runs — passed down so the export / optimize
	 *  button can offer them; don't include the "all" sentinel here. */
	availableModels?: string[];
	searchHighlight?: string;
	// Whether this prompt has ever been evaluated (all-time)
	// Used to distinguish "never evaluated" vs "no data in selected window"
	hasEverBeenEvaluated?: boolean;
}

// Memoized: when a sibling filter / react-query state change re-renders
// VirtualizedPromptList with identical props, 30+ of these don't need to
// walk their internal useMemos again.
export const CachedPromptChart = memo(function CachedPromptChart({
	promptId,
	promptName,
	brandId,
	lookback = "1m",
	selectedModel = "all",
	availableModels = [],
	searchHighlight = "",
	hasEverBeenEvaluated = false,
}: CachedPromptChartProps) {
	// Get data from context (pre-loaded)
	const chartContext = useOptionalChartDataContext();
	
	// Get processed chart data for this specific prompt
	const chartData = useMemo(() => {
		if (!chartContext) return null;
		return chartContext.getChartDataForPrompt(promptId);
	}, [chartContext, promptId]);

	// Setup export functionality
	const fileName = chartContext?.brand 
		? `${chartContext.brand.name}-${promptName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}`
		: `chart-${promptName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}`;
	const { isExporting, handleExport, portal: exportPortal } = useChartExport(fileName);

	const brand = chartContext?.brand ?? null;
	const competitors = chartContext?.competitors;
	const data = chartData?.chartData;
	const totalRuns = chartData?.totalRuns ?? 0;
	const hasVisibilityData = chartData?.hasVisibilityData ?? false;
	const lastBrandVisibility = chartData?.lastBrandVisibility ?? null;

	const handleDownload = useCallback(() => {
		if (!brand || !data || !competitors) return;
		handleExport({
			promptName,
			visibility: lastBrandVisibility,
			data,
			lookback,
			brand,
			competitors,
		});
	}, [handleExport, promptName, lastBrandVisibility, data, lookback, brand, competitors]);

	// Loading state — structure matches the success state card exactly:
	// CardHeader (title + badge), Separator, CardContent (pl-0 pr-6, h-[250px]), footer
	if (!chartContext || chartContext.isLoading || !chartData) {
		return (
			<Card className="py-3 gap-3">
				<CardHeader className="flex justify-between items-center px-3">
					<Skeleton className="h-4 w-48" />
					<Skeleton className="h-5 w-24 rounded-full" />
				</CardHeader>
				<Separator className="py-0 my-0" />
				<CardContent className="pl-0 pr-6">
					<div className="h-[250px] flex items-center justify-center">
						<div className="space-y-2">
							<Skeleton className="h-4 w-32 mx-auto" />
							<div className="flex justify-center space-x-2">
								<div className="h-2 w-2 bg-primary/20 rounded-full animate-pulse" />
								<div className="h-2 w-2 bg-primary/20 rounded-full animate-pulse [animation-delay:0.2s]" />
								<div className="h-2 w-2 bg-primary/20 rounded-full animate-pulse [animation-delay:0.4s]" />
							</div>
						</div>
					</div>
				</CardContent>
				<Separator className="py-0 my-0" />
				<CardFooter className="flex items-center justify-between px-3 pt-3 pb-0">
					<div className="flex items-center gap-2">
						<Skeleton className="h-6 w-16 rounded" />
						<Skeleton className="h-6 w-24 rounded" />
					</div>
					<Skeleton className="h-6 w-20 rounded" />
				</CardFooter>
			</Card>
		);
	}

	// No runs state - distinguish between "never evaluated" vs "no data in selected window"
	if (totalRuns === 0) {
		const isFirstEval = !hasEverBeenEvaluated;

		return (
			<Card className="py-3 gap-3">
				<CardHeader className="flex justify-between items-center px-3">
					<PromptTitle name={promptName} highlight={searchHighlight} />
				</CardHeader>
				<Separator className="py-0 my-0" />
				{/* h-[300px] instead of h-[250px] to compensate for the missing footer section,
				   keeping overall card height consistent with data-filled cards for virtualization */}
				<CardContent className="px-3">
					<div className="h-[300px] flex items-center justify-center">
						<div className="flex flex-col items-center text-center max-w-xs">
							{isFirstEval ? (
								<>
									<div className="flex space-x-1.5 mb-3">
										<div className="h-2 w-2 rounded-full bg-muted-foreground/30 animate-pulse" />
										<div className="h-2 w-2 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:0.2s]" />
										<div className="h-2 w-2 rounded-full bg-muted-foreground/30 animate-pulse [animation-delay:0.4s]" />
									</div>
									<p className="text-sm font-medium text-muted-foreground">
										Evaluating for the first time
									</p>
									<p className="text-xs text-muted-foreground/70 mt-1">
										Results will appear here shortly.
									</p>
								</>
							) : (
								<>
									<div className="h-16 w-full mb-3 flex items-end justify-center gap-[3px]">
									{PLACEHOLDER_BARS_NO_DATA.map((bar) => (
										<div
											key={bar.key}
											className="w-1.5 rounded-sm bg-muted-foreground/10"
											style={{ height: `${bar.h}%` }}
										/>
									))}
									</div>
									<p className="text-sm font-medium text-muted-foreground">
										No data in selected time range
									</p>
									<p className="text-xs text-muted-foreground/70 mt-1">
										Try selecting a longer time period to see historical data.
									</p>
								</>
							)}
						</div>
					</div>
				</CardContent>
			</Card>
		);
	}

	// No visibility data state
	if (!hasVisibilityData) {
		return (
			<>
				{exportPortal}
				<Card className="py-3 gap-3">
					<CardHeader className="flex justify-between items-center px-3">
						<PromptTitle name={promptName} highlight={searchHighlight} />
					</CardHeader>
					<Separator className="py-0 my-0" />
					<CardContent className="px-3">
						<div className="h-[250px] flex items-center justify-center">
							<div className="flex flex-col items-center text-center max-w-xs">
								<div className="h-16 w-full mb-3 flex items-end justify-center gap-[3px]">
								{PLACEHOLDER_BARS_NO_VISIBILITY.map((bar) => (
									<div
										key={bar.key}
										className="w-1.5 rounded-sm bg-muted-foreground/10"
										style={{ height: `${bar.h}%` }}
									/>
								))}
								</div>
								<p className="text-sm font-medium text-muted-foreground">
									No brands found in responses
								</p>
								<p className="text-xs text-muted-foreground/70 mt-1">
									Your brand and competitors weren't mentioned in the evaluated responses for this prompt.
								</p>
							</div>
						</div>
					</CardContent>
					<div className="print:hidden">
						<ChartActionsFooter 
							promptId={promptId} 
							brandId={brandId}
							promptName={promptName}
							onDownload={handleDownload}
							isDownloading={isExporting}
							selectedModel={selectedModel}
							availableModels={availableModels}
							lookback={lookback}
						/>
					</div>
				</Card>
			</>
		);
	}

	// Success state with chart
	return (
		<>
			{exportPortal}
			<Card className="py-3 gap-3">
				<CardHeader className="flex justify-between items-center px-3">
					<PromptTitle name={promptName} highlight={searchHighlight} />
					{lastBrandVisibility !== null && (
						<Badge variant={getBadgeVariant(lastBrandVisibility)} className={getBadgeClassName(lastBrandVisibility)}>
							{lastBrandVisibility}% Visibility
						</Badge>
					)}
				</CardHeader>
				<Separator className="py-0 my-0" />
				<CardContent className="pl-0 pr-6">
					{brand && data && competitors && (
						<BaseChart
							data={data}
							lookback={lookback}
							brand={brand}
							competitors={competitors}
							isAnimationActive={false}
							chartType="line"
						/>
					)}
				</CardContent>
				<div className="print:hidden">
					<ChartActionsFooter 
						promptId={promptId} 
						brandId={brandId}
						promptName={promptName}
						onDownload={handleDownload}
						isDownloading={isExporting}
						selectedModel={selectedModel}
						availableModels={availableModels}
						lookback={lookback}
					/>
				</div>
			</Card>
		</>
	);
});
