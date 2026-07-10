
import * as React from "react";
import { Line, LineChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	ChartConfig,
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartTooltip,
	ChartTooltipContent,
} from "@workspace/ui/components/chart";
import { Badge } from "@workspace/ui/components/badge";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import {
	LookbackPeriod,
	ChartDataPoint,
	filterAndCompleteChartData,
	extendLinesToChartEdges,
	isExtendedDataPoint,
	getBadgeVariant,
	getBadgeClassName,
	selectCompetitorsToDisplay,
} from "@/lib/chart-utils";
import type { Brand, Competitor } from "@workspace/lib/db/schema";

interface BaseChartProps {
	data: ChartDataPoint[];
	lookback: LookbackPeriod;
	title?: string;
	visibility?: number | null;
	showTitle?: boolean;
	showBadge?: boolean;
	brand: Brand;
	competitors: Competitor[];
	isAnimationActive?: boolean;
	chartType?: "bar" | "line";
	chartColors?: string[];
	chartHeight?: string;
}

export function BaseChart({
	data,
	lookback,
	title,
	visibility,
	showTitle = false,
	showBadge = false,
	brand,
	competitors,
	isAnimationActive = false,
	chartType = "line",
	chartColors: chartColorsProp,
	chartHeight = "250px",
}: BaseChartProps) {
	const completeData = filterAndCompleteChartData(data, lookback);
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };

	// Sort all competitors alphabetically for consistent color assignment
	const sortedAllCompetitors = [...competitors].sort((a, b) => a.name.localeCompare(b.name));

	// Select top competitors to display (max 3)
	const selectedCompetitors = selectCompetitorsToDisplay(competitors, completeData, 3);

	// Sort selected competitors alphabetically to maintain consistent ordering
	const sortedSelectedCompetitors = [...selectedCompetitors].sort((a, b) => a.name.localeCompare(b.name));

	// Create dynamic chart config based on brand and ALL competitors (for consistent colors)
	const chartColors = chartColorsProp ?? context.clientConfig?.branding.chartColors ?? [];
	const chartConfig: ChartConfig = {
		visitors: {
			label: "Visibility",
		},
		[brand.id]: {
			label: brand.name,
			color: chartColors[0], // Brand gets first color
		},
	};

	// Add ALL competitors to config with consistent colors based on their position in the full sorted list
	sortedAllCompetitors.forEach((competitor, index) => {
		const colorIndex = (index + 1) % chartColors.length;
		chartConfig[competitor.id] = {
			label: competitor.name,
			color: chartColors[colorIndex],
		};
	});

	// Get data keys for rendering lines (only selected competitors + brand)
	// Brand comes last so it renders on top when dots overlap
	const dataKeys = [...sortedSelectedCompetitors.map((c) => c.id), brand.id];

	// Build custom legend payload to only show brand + selected competitors (not duplicates from dashed/solid lines)
	const legendPayload = [
		{ value: brand.name, dataKey: brand.id, color: chartConfig[brand.id].color },
		...sortedSelectedCompetitors.map((c) => ({
			value: c.name,
			dataKey: c.id,
			color: chartConfig[c.id].color,
		})),
	];

	// For bar charts, filter out days where ALL entities have null values
	// For line charts, keep all days to maintain proper time-based spacing on x-axis
	// and extend lines to chart edges to fill gaps at start/end of data collection
	const chartData = chartType === "bar" 
		? completeData.filter(point => {
				// Keep the data point if ANY tracked entity has a non-null value
				return dataKeys.some(key => {
					const value = point[key];
					return value !== null && value !== undefined;
				});
			})
		: extendLinesToChartEdges(completeData, dataKeys).map(point => {
				// Add _solid versions of each key that have null for extended points
				const newPoint = { ...point };
				for (const key of dataKeys) {
					if (isExtendedDataPoint(point, key)) {
						newPoint[`${key}_solid`] = null;
					} else {
						newPoint[`${key}_solid`] = point[key];
					}
				}
				return newPoint;
			});

	return (
		<div className="flex-1 space-y-2">
			{showTitle && (
				<div className="flex items-center justify-center gap-2">
					{title && <h3 className="text-sm font-medium capitalize">{title}</h3>}
					{showBadge && visibility !== null && (
						<Badge variant={getBadgeVariant(visibility!)} className={`text-xs ${getBadgeClassName(visibility!)}`}>
							{visibility}%
						</Badge>
					)}
				</div>
			)}
		{chartType === "bar" ? (
			<ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: chartHeight }}>
				<BarChart data={chartData}>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="date"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={32}
							domain={["dataMin", "dataMax"]}
							type="category"
							tickFormatter={(value) => {
								// Fix: Parse date string directly to avoid double timezone conversion
								// value is already a properly bucketed date string like "2025-07-21"
								const [year, month, day] = value.split("-").map(Number);
								const date = new Date(year, month - 1, day); // Create local date
								return date.toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
								});
							}}
						/>
						<YAxis
							domain={[0, "auto"]}
							type="number"
							allowDataOverflow={false}
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickCount={6}
							tickFormatter={(value) => `${value}%`}
						/>
						<ChartTooltip
							isAnimationActive={false}
							cursor={false}
							content={
								<ChartTooltipContent
								labelFormatter={(value) => {
									const [year, month, day] = String(value).split("-").map(Number);
									const date = new Date(year, month - 1, day);
										return date.toLocaleDateString("en-US", {
											month: "short",
											day: "numeric",
										});
									}}
									indicator="dot"
									formatter={(value, name, item, index) => {
										const indicatorColor = chartConfig[name as string]?.color;
										return (
											<>
												<div
													className="shrink-0 rounded-[2px] h-2.5 w-2.5"
													style={{
														backgroundColor: indicatorColor,
													}}
												/>
												<div className="flex flex-1 justify-between gap-4 leading-none items-center">
													<div className="grid gap-1.5">
														<span className="text-muted-foreground">{chartConfig[name as string]?.label || name}</span>
													</div>
													{value !== null && value !== undefined && (
														<span className="text-foreground font-mono font-xs tabular-nums">{value}%</span>
													)}
												</div>
											</>
										);
									}}
								/>
							}
						/>
						{dataKeys.map((key, index) => (
							<Bar key={key} dataKey={key} fill={`var(--color-${key})`} minPointSize={2} radius={2} />
						))}
						<ChartLegend content={() => <ChartLegendContent payload={legendPayload} className="flex-wrap gap-x-4 gap-y-1" />} />
					</BarChart>
				</ChartContainer>
		) : (
			<ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: chartHeight }}>
				<LineChart data={chartData}>
						<CartesianGrid vertical={false} />
						<XAxis
							dataKey="date"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={32}
							domain={["dataMin", "dataMax"]}
							type="category"
							tickFormatter={(value) => {
								// Fix: Parse date string directly to avoid double timezone conversion
								// value is already a properly bucketed date string like "2025-07-21"
								const [year, month, day] = value.split("-").map(Number);
								const date = new Date(year, month - 1, day); // Create local date
								return date.toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
								});
							}}
						/>
						<YAxis
							domain={[0, "auto"]}
							type="number"
							allowDataOverflow={false}
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							tickCount={6}
							tickFormatter={(value) => `${value}%`}
						/>
						<ChartTooltip
							isAnimationActive={false}
							cursor={false}
							content={({ active, payload, label }) => {
								if (!active || !payload?.length) return null;
								
								// Filter to only show:
								// 1. Original keys (not _solid versions) from the dashed lines
								// 2. Only non-extended values
								const filteredPayload = payload.filter((item: any) => {
									const key = item.dataKey as string;
									// Skip _solid keys - we only want the original keys from dashed lines
									if (key.endsWith('_solid')) return false;
									// Skip extended data points
									if (item.payload && isExtendedDataPoint(item.payload, key)) return false;
									// Skip null/undefined values
									if (item.value === null || item.value === undefined) return false;
									return true;
								});
								
								// If no real data to show, hide tooltip entirely
								if (filteredPayload.length === 0) return null;
								
								// Format the date label
								const [year, month, day] = (label as string).split("-").map(Number);
								const date = new Date(year, month - 1, day);
								const formattedDate = date.toLocaleDateString("en-US", {
									month: "short",
									day: "numeric",
								});
								
								return (
									<div className="border-border/50 bg-background grid min-w-[8rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
										<div className="font-medium">{formattedDate}</div>
										<div className="grid gap-1.5">
											{filteredPayload.map((item: any) => {
												const indicatorColor = chartConfig[item.dataKey as string]?.color;
												return (
													<div key={item.dataKey} className="flex w-full items-center gap-2">
														<div
															className="shrink-0 rounded-[2px] h-2.5 w-2.5"
															style={{ backgroundColor: indicatorColor }}
														/>
														<div className="flex flex-1 justify-between gap-4 leading-none items-center">
															<span className="text-muted-foreground">
																{chartConfig[item.dataKey as string]?.label || item.dataKey}
															</span>
															<span className="text-foreground font-mono font-xs tabular-nums">
																{item.value}%
															</span>
														</div>
													</div>
												);
											})}
										</div>
									</div>
								);
							}}
						/>
					{/* Render two lines per entity: dashed for extended data, solid for real data */}
					{dataKeys.flatMap((key) => [
						// First: Dashed line showing extended/extrapolated portions (hidden from legend)
						<Line
							key={`${key}-dashed`}
							dataKey={key}
							name={`${key}-dashed`}
							type="bump"
							stroke={`var(--color-${key})`}
							strokeWidth={2}
							strokeDasharray="4 4"
							dot={false}
							activeDot={false}
							connectNulls={true}
							isAnimationActive={isAnimationActive}
							legendType="none"
						/>,
						// Second: Solid line overlay for real data (shows in legend)
						<Line
							key={`${key}-solid`}
							dataKey={`${key}_solid`}
							name={key}
							type="bump"
							stroke={`var(--color-${key})`}
							strokeWidth={2}
							// Custom dot that only shows for real data points
						dot={({ cx, cy, payload, value }: any) => {
							// Don't render dot for extended points or null values
							// Return empty <g> element instead of null to satisfy Recharts types
							if (!payload || isExtendedDataPoint(payload, key) || value === null || value === undefined) {
								return <g key={`dot-empty-${key}-${cx}`} />;
							}
							return (
								<circle
									key={`dot-${key}-${cx}`}
									cx={cx}
									cy={cy}
									r={2}
									fill={`var(--color-${key})`}
									stroke={`var(--color-${key})`}
									strokeWidth={2}
								/>
							);
						}}
						activeDot={({ cx, cy, payload, value }: any) => {
							// Don't render active dot for extended points or null values
							// Return empty <g> element instead of null to satisfy Recharts types
							if (!payload || isExtendedDataPoint(payload, key) || value === null || value === undefined) {
								return <g key={`activedot-empty-${key}-${cx}`} />;
							}
							return (
								<circle
									key={`activedot-${key}-${cx}`}
									cx={cx}
									cy={cy}
									r={4}
									fill={`var(--color-${key})`}
									stroke={`var(--color-${key})`}
									strokeWidth={2}
								/>
							);
						}}
							connectNulls={true}
							isAnimationActive={isAnimationActive}
						/>,
					])}
						<ChartLegend content={() => <ChartLegendContent payload={legendPayload} className="flex-wrap gap-x-4 gap-y-1" />} />
					</LineChart>
				</ChartContainer>
			)}
		</div>
	);
}
