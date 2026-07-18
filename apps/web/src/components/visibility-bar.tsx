
import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";

interface VisibilityTimeSeriesPoint {
	date: string;
	visibility: number | null;
}

interface VisibilityBarProps {
	currentVisibility: number;
	totalRuns: number;
	totalPrompts: number;
	totalCitations: number;
	visibilityTimeSeries: VisibilityTimeSeriesPoint[];
	lookback: string;
	isLoading?: boolean;
}

function getVisibilityColors(value: number) {
	if (value > 75) {
		return {
			bg: "bg-emerald-50 dark:bg-emerald-950/40",
			text: "text-emerald-600 dark:text-emerald-400",
			border: "border-emerald-200 dark:border-emerald-800/60",
			muted: "text-emerald-600/70 dark:text-emerald-400/70",
			stroke: "#10b981",
			fill: "#10b981",
		};
	}
	if (value > 45) {
		return {
			bg: "bg-amber-50 dark:bg-amber-950/40",
			text: "text-amber-600 dark:text-amber-400",
			border: "border-amber-200 dark:border-amber-800/60",
			muted: "text-amber-600/70 dark:text-amber-400/70",
			stroke: "#f59e0b",
			fill: "#f59e0b",
		};
	}
	return {
		bg: "bg-rose-50 dark:bg-rose-950/40",
		text: "text-rose-600 dark:text-rose-400",
		border: "border-rose-200 dark:border-rose-800/60",
		muted: "text-rose-600/70 dark:text-rose-400/70",
		stroke: "#ef4444",
		fill: "#ef4444",
	};
}

export function VisibilityBar({
	currentVisibility,
	totalRuns,
	totalPrompts,
	totalCitations,
	visibilityTimeSeries,
	lookback,
	isLoading = false,
}: VisibilityBarProps) {
	if (isLoading) {
		return <VisibilityBarSkeleton />;
	}

	// Don't render if no data
	if (totalRuns === 0) {
		return null;
	}

	const colors = getVisibilityColors(currentVisibility);
	const showChart = lookback !== "1w";

	// Prepare chart data
	const chartData = visibilityTimeSeries.map(point => ({
		date: point.date,
		value: point.visibility ?? 0,
	}));

	return (
		<div className={`flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 min-h-10 px-3 py-2 rounded-lg border ${colors.bg} ${colors.border}`}>
			{/* Left side: visibility + chart + info */}
			<div className="flex items-center gap-2 min-w-0 shrink-0">
				<span className={`text-base sm:text-lg font-semibold whitespace-nowrap ${colors.text}`}>
					{currentVisibility}% <span className="font-normal">Visibility</span>
				</span>
				
				{showChart && (
					<div className="w-24 h-6 hidden sm:block shrink-0">
						<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
							<AreaChart data={chartData} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
								<YAxis domain={[0, "auto"]} hide />
								<Area
									type="monotone"
									dataKey="value"
									stroke={colors.stroke}
									fill={colors.fill}
									fillOpacity={0.2}
									strokeWidth={1.5}
									dot={false}
									isAnimationActive={false}
									connectNulls
								/>
							</AreaChart>
						</ResponsiveContainer>
					</div>
				)}

				<Tooltip>
					<TooltipTrigger asChild>
						<IconInfoCircle className={`h-3.5 w-3.5 shrink-0 ${colors.muted} cursor-help`} />
					</TooltipTrigger>
					<TooltipContent side="bottom" className="max-w-xs text-sm">
						AI visibility for the {totalPrompts.toLocaleString()} prompt{totalPrompts !== 1 ? 's' : ''} shown below, calculated as the percentage of AI responses that mention your brand over the time period for the selected filters.
					</TooltipContent>
				</Tooltip>
			</div>
			
			{/* Right side: stats */}
			<div className={`flex items-center gap-x-3 text-xs sm:text-sm ${colors.muted}`}>
				<span><span className="font-medium">{totalPrompts.toLocaleString()}</span> prompts</span>
				<span><span className="font-medium">{totalRuns.toLocaleString()}</span> runs</span>
				<span><span className="font-medium">{totalCitations.toLocaleString()}</span> citations</span>
			</div>
		</div>
	);
}

export function VisibilityBarSkeleton() {
	return (
		<div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 min-h-10 px-3 py-2 rounded-lg border bg-muted/30">
			<div className="flex items-center gap-3">
				<Skeleton className="h-6 sm:h-7 w-36" />
				<Skeleton className="h-6 w-24 hidden sm:block" />
			</div>
			<div className="flex items-center gap-x-3">
				<Skeleton className="h-4 sm:h-5 w-16" />
				<Skeleton className="h-4 sm:h-5 w-14" />
				<Skeleton className="h-4 sm:h-5 w-20" />
			</div>
		</div>
	);
}

export function VisibilityBarEmpty() {
	return (
		<div className="flex items-center min-h-10 px-3 py-2 rounded-lg border border-border/60 bg-muted/20">
			<span className="text-sm text-muted-foreground">
				No visibility data for the selected time range and filters.
			</span>
		</div>
	);
}
