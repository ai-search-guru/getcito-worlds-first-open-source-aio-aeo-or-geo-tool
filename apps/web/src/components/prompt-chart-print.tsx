
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Badge } from "@workspace/ui/components/badge";
import { BaseChartPrint } from "./base-chart-print";
import { ChartDownloadFooter } from "./chart-download-footer";
import { useChartDownload } from "@/hooks/use-chart-download";
import type { Brand, Competitor } from "@workspace/lib/db/schema";
import {
	LookbackPeriod,
	getBadgeVariant,
	getBadgeClassName,
	calculateVisibilityPercentages,
	selectCompetitorsToDisplay,
	type ChartDataPoint,
} from "@/lib/chart-utils";
import { getSoVBadgeClasses, type PromptCategory } from "@workspace/lib/report-metrics";

interface PromptRunData {
	id: string;
	promptId: string;
	brandId: string;
	brandMentioned: boolean;
	competitorsMentioned: string[];
	createdAt: Date;
	model: string;
	provider: string | null;
	version: string;
	webSearchEnabled: boolean;
	rawOutput: any;
	webQueries: string[];
}

interface PromptChartPrintProps {
	lookback: LookbackPeriod;
	promptName: string;
	promptId: string;
	brand: Brand;
	competitors: Competitor[];
	promptRuns: PromptRunData[];
	// Whether this prompt has ever been evaluated (all-time)
	// Used to distinguish "never evaluated" vs "no data in selected window"
	hasEverBeenEvaluated?: boolean;
	// Optional category for report display
	category?: PromptCategory;
}

/**
 * Compute SoV for each entity (brand + competitors) from prompt runs.
 * Returns data shaped for BaseChartPrint: one data point with entity IDs as keys.
 */
function computeSoVChartData(
	runs: PromptRunData[],
	brand: Brand,
	competitors: Competitor[],
): ChartDataPoint[] | null {
	if (runs.length === 0) return null;

	// Count mentions
	let brandMentions = 0;
	const competitorMentions: Record<string, number> = {};
	for (const comp of competitors) {
		competitorMentions[comp.id] = 0;
	}

	for (const run of runs) {
		if (run.brandMentioned) brandMentions++;
		if (run.competitorsMentioned) {
			for (const comp of competitors) {
				if (run.competitorsMentioned.includes(comp.name)) {
					competitorMentions[comp.id]++;
				}
			}
		}
	}

	// Total mentions across all entities
	const totalMentions = brandMentions + Object.values(competitorMentions).reduce((s, c) => s + c, 0);
	if (totalMentions === 0) return null;

	// Build chart data point with SoV percentages
	const dataPoint: ChartDataPoint = { date: "sov" };
	dataPoint[brand.id] = Math.round((brandMentions / totalMentions) * 100);
	for (const comp of competitors) {
		dataPoint[comp.id] = Math.round((competitorMentions[comp.id] / totalMentions) * 100);
	}

	return [dataPoint];
}

export function PromptChartPrint({
	lookback = "1m",
	promptName,
	promptId,
	brand,
	competitors,
	promptRuns,
	hasEverBeenEvaluated = false,
	category,
}: PromptChartPrintProps) {
	const fileName = `${brand.name}-${promptName.replace(/[^a-zA-Z0-9]/g, "_").substring(0, 50)}`;
	const { chartRef, isDownloading, handleDownload } = useChartDownload(fileName);

	// Filter prompt runs for this specific prompt
	const promptSpecificRuns = promptRuns?.filter((run) => run.promptId === promptId) || [];

	// Check if we have no prompt runs
	const hasNoRuns = promptSpecificRuns.length === 0;

	// For report context: use SoV-based chart data. For dashboard: use visibility time-series.
	const isReportContext = !!category;
	const sovChartData = isReportContext ? computeSoVChartData(promptSpecificRuns, brand, competitors) : null;

	// Dashboard mode: time-series visibility
	const chartData = isReportContext ? (sovChartData ?? []) : calculateVisibilityPercentages(promptSpecificRuns, brand, competitors, lookback);

	// Select top competitors by visibility, filling with alphabetical order if needed
	const selectedCompetitors = selectCompetitorsToDisplay(competitors, chartData, 5);

	// Check if there's any non-zero data for brand or selected competitors
	const hasVisibilityData = chartData.some((dataPoint) => {
		const brandValue = dataPoint[brand.id] as number;
		if (brandValue !== null && brandValue !== undefined && Number(brandValue) > 0) {
			return true;
		}
		return selectedCompetitors.some((competitor) => {
			const value = dataPoint[competitor.id] as number;
			return value !== null && value !== undefined && Number(value) > 0;
		});
	});

	// Badge value: SoV for reports, visibility for dashboard
	const badgeValue = isReportContext
		? (sovChartData ? (sovChartData[0][brand.id] as number) : null)
		: (() => {
			const lastDataPoint = chartData.filter((point) => brand && point[brand.id] !== null).pop();
			return lastDataPoint && brand ? (lastDataPoint[brand.id] as number) : null;
		})();

	const badgeLabel = isReportContext ? "SoV" : "Visibility";

	if (hasNoRuns) {
		const message = hasEverBeenEvaluated
			? "No data in selected time range"
			: "Evaluating for the first time...";

		return (
			<Card ref={chartRef} className="py-3 gap-3 print:shadow-none print:border">
				<CardHeader className="flex justify-between items-center px-3">
					<CardTitle className="text-sm print:text-xs">{promptName}</CardTitle>
				</CardHeader>
				<Separator className="py-0 my-0" />
				<CardContent className="px-3">
					<div>
						<span className="font-semibold text-xl sm:text-2xl md:text-3xl lg:text-4xl text-muted-foreground print:text-lg">
							{message}
						</span>
					</div>
				</CardContent>
				<ChartDownloadFooter onDownload={handleDownload} isDownloading={isDownloading} />
			</Card>
		);
	}

	// Show "No brands found" message when there's no data
	if (!hasVisibilityData) {
		return (
			<Card ref={chartRef} className="py-3 gap-3 print:shadow-none print:border">
				<CardHeader className="flex justify-between items-center px-3">
					<CardTitle className="text-sm print:text-xs">{promptName}</CardTitle>
				</CardHeader>
				<Separator className="py-0 my-0" />
				<CardContent className="px-3">
					<div className="h-[250px] flex items-center justify-center">
						<div className="flex flex-col items-center text-center max-w-xs">
							<p className="text-sm font-medium text-muted-foreground print:text-xs">
								No brands found in responses
							</p>
							<p className="text-xs text-muted-foreground/70 mt-1 print:text-[10px]">
								Your brand and competitors weren't mentioned in the evaluated responses for this prompt.
							</p>
						</div>
					</div>
				</CardContent>
				<ChartDownloadFooter onDownload={handleDownload} isDownloading={isDownloading} />
			</Card>
		);
	}

	const badgeClasses = isReportContext && badgeValue !== null
		? getSoVBadgeClasses(badgeValue)
		: badgeValue !== null
			? { variant: getBadgeVariant(badgeValue) as "default" | "secondary" | "destructive", className: getBadgeClassName(badgeValue) }
			: null;

	return (
	<Card ref={chartRef} className="py-3 gap-3 print:shadow-none print:border print:break-inside-avoid">
		<CardHeader className="flex justify-between items-center px-3">
			<CardTitle className="text-sm print:text-xs">{promptName}</CardTitle>
			<div className="flex items-center gap-2">
				{badgeClasses && badgeValue !== null && (
					<Badge
						variant={badgeClasses.variant}
						className={`${badgeClasses.className} print:text-xs`}
					>
						{badgeValue}% {badgeLabel}
					</Badge>
				)}
			</div>
		</CardHeader>
		<Separator className="py-0 my-0" />
		<CardContent className="p-0">
			<BaseChartPrint data={chartData} brand={brand} competitors={selectedCompetitors} />
		</CardContent>
			<ChartDownloadFooter onDownload={handleDownload} isDownloading={isDownloading} />
		</Card>
	);
}
