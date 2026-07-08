/**
 * Shared trend area-chart used by the overview's AI Visibility and Share of
 * Voice sections and the Share of Voice page. It takes only a label, a color,
 * and a {date, value} series — everything else (axis formatting, the
 * auto-ranged y-axis, the tooltip, the softened fill) is fixed here so the
 * stacked trends stay visually identical without being tuned in two places.
 */
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@workspace/ui/components/chart";

export interface TrendPoint {
	date: string;
	value: number | null;
}

/** Build a local Date from a "YYYY-MM-DD" string (avoids the UTC off-by-one of `new Date(iso)`). */
function localDate(value: string): Date {
	const [year, month, day] = value.split("-").map(Number);
	return new Date(year, month - 1, day);
}

export function TrendChart({
	data,
	label,
	color,
	className = "aspect-auto h-full w-full",
}: {
	data: TrendPoint[];
	label: string;
	color: string;
	className?: string;
}) {
	const config = { value: { label, color } } satisfies ChartConfig;

	return (
		<ChartContainer config={config} className={className}>
			<AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
				<CartesianGrid vertical={false} strokeDasharray="3 3" />
				<XAxis
					dataKey="date"
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					minTickGap={50}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: string) =>
						localDate(value).toLocaleDateString("en-US", { month: "short", day: "numeric" })
					}
				/>
				<YAxis
					domain={[0, "auto"]}
					tickLine={false}
					axisLine={false}
					tickMargin={8}
					tickCount={4}
					tick={{ fontSize: 11 }}
					tickFormatter={(value: number) => `${value}%`}
				/>
				<ChartTooltip
					isAnimationActive={false}
					cursor={false}
					content={({ active, payload, label: dateLabel }) => {
						if (!active || !payload?.length) return null;
						const value = payload[0]?.value as number | null;
						if (value == null) return null;
						const formattedDate = localDate(dateLabel as string).toLocaleDateString("en-US", {
							month: "long",
							day: "numeric",
							year: "numeric",
						});
						return (
							<div className="border-border/50 bg-background grid min-w-[12rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
								<div className="font-medium">{formattedDate}</div>
								<div className="flex items-center gap-2">
									<div className="shrink-0 rounded-[2px] h-2.5 w-2.5" style={{ background: color }} />
									<span className="text-muted-foreground">{label}</span>
									<span className="ml-auto font-mono tabular-nums">{value}%</span>
								</div>
							</div>
						);
					}}
				/>
				<Area
					dataKey="value"
					type="monotone"
					stroke={color}
					strokeWidth={2}
					fill={color}
					fillOpacity={0.18}
					connectNulls
				/>
			</AreaChart>
		</ChartContainer>
	);
}
