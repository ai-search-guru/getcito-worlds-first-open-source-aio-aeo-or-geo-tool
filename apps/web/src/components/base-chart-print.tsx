
import * as React from "react";
import { Bar, BarChart, XAxis, YAxis, ResponsiveContainer, Cell } from "recharts";
import { Badge } from "@workspace/ui/components/badge";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { ChartDataPoint, getBadgeVariant, getBadgeClassName } from "@/lib/chart-utils";
import type { Brand, Competitor } from "@workspace/lib/db/schema";

interface BaseChartPrintProps {
	data: ChartDataPoint[];
	title?: string;
	visibility?: number | null;
	showTitle?: boolean;
	showBadge?: boolean;
	brand: Brand;
	competitors: Competitor[];
}

interface BarData {
	name: string;
	value: number;
	color: string;
	isBrand: boolean;
}

function CustomXAxisTick(props: any) {
	const { x, y, payload, brandName } = props;
	const isCurrentBrand = payload.value === brandName;

	return (
		<g transform={`translate(${x},${y})`}>
			<text
				x={0}
				y={0}
				dy={8}
				textAnchor="middle"
				fill="#374151"
				fontSize="10"
				fontWeight={isCurrentBrand ? "bold" : "normal"}
			>
				{payload.value}
			</text>
		</g>
	);
}

export function BaseChartPrint({
	data,
	title,
	visibility,
	showTitle = false,
	showBadge = false,
	brand,
	competitors,
}: BaseChartPrintProps) {
	const routeContext = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	// Get the most recent data point that has actual data
	const latestDataPoint = data
		.filter((point) => {
			// Check if any brand or competitor has non-null data
			const allIds = [brand.id, ...competitors.map((c) => c.id)];
			return allIds.some((id) => point[id] !== null && point[id] !== undefined);
		})
		.pop();

	if (!latestDataPoint) {
		return (
			<div className="flex-1 space-y-2 print:space-y-1">
				{showTitle && (
					<div className="flex items-center justify-center gap-2">
						{title && <h3 className="text-sm font-medium capitalize print:text-xs">{title}</h3>}
					</div>
				)}
				<div className="h-[200px] print:h-[150px] flex items-center justify-center text-muted-foreground text-sm print:text-xs">
					No data available
				</div>
			</div>
		);
	}

	// Create bar data for all entities (brand + competitors)
	const chartColors = routeContext.clientConfig?.branding.chartColors ?? [];
	const allEntities: BarData[] = [];

	// Add brand data
	const brandValue = latestDataPoint[brand.id] as number;
	if (brandValue !== null && brandValue !== undefined) {
		allEntities.push({
			name: brand.name,
			value: brandValue,
			color: chartColors[0],
			isBrand: true,
		});
	}

	// Add competitor data
	competitors.forEach((competitor, index) => {
		const competitorValue = latestDataPoint[competitor.id] as number;
		if (competitorValue !== null && competitorValue !== undefined) {
			const colorIndex = (index + 1) % chartColors.length;
			allEntities.push({
				name: competitor.name,
				value: competitorValue,
				color: chartColors[colorIndex],
				isBrand: false,
			});
		}
	});

	// Sort all entities by value (highest first), then limit to top 6 (including brand if present)
	const sortedEntities = allEntities.sort((a, b) => b.value - a.value).slice(0, 6);

	return (
		<div className="flex-1">
			{showTitle && (
				<div className="flex items-center justify-center gap-2">
					{title && <h3 className="text-sm font-medium capitalize print:text-xs">{title}</h3>}
					{showBadge && visibility !== null && (
						<Badge
							variant={getBadgeVariant(visibility!)}
							className={`text-xs ${getBadgeClassName(visibility!)} print:text-xs`}
						>
							{visibility}%
						</Badge>
					)}
				</div>
			)}
		<div className="h-[300px] w-full">
			<ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
				<BarChart data={sortedEntities} margin={{ top: 20, right: 15, left: 20, bottom: 0 }} barCategoryGap="20%">
						<XAxis
							dataKey="name"
							axisLine={false}
							tickLine={false}
							tick={<CustomXAxisTick brandName={brand.name} />}
							height={30}
							interval={0}
						/>
						<YAxis
							domain={[0, "auto"]}
							axisLine={false}
							tickLine={false}
							tick={{
								fontSize: 10,
								fill: "#6B7280",
							}}
							tickFormatter={(value) => `${value}%`}
							width={40}
						/>
						<Bar
							dataKey="value"
							radius={[4, 4, 0, 0]}
							minPointSize={2}
							label={{
								position: "top",
								fontSize: 11,
								fontWeight: "bold",
								fill: "#374151",
								formatter: (value: unknown) => `${value}%`,
							}}
						>
							{sortedEntities.map((entry) => (
								<Cell key={entry.name} fill={entry.color} />
							))}
						</Bar>
					</BarChart>
				</ResponsiveContainer>
			</div>
		</div>
	);
}
