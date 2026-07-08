import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
	type ChartConfig,
	ChartContainer,
	ChartTooltip,
} from "@workspace/ui/components/chart";

export function TrendAreaChart({
	title,
	tooltip,
	data,
	keys,
	meta,
}: {
	title: string;
	tooltip: string;
	data: Array<Record<string, number | string>>;
	keys: string[];
	meta: Record<string, { label: string; color: string }>;
}) {
	// Callers pass exactly the keys that appear (same lists the tab filters use).
	const present = keys;
	// Display order: largest band first, "other" always last.
	const totals = new Map(present.map((k) => [k, data.reduce((s, d) => s + (typeof d[k] === "number" ? (d[k] as number) : 0), 0)]));
	const ordered = [...present].sort((a, b) => (a === "other" ? 1 : b === "other" ? -1 : (totals.get(b) ?? 0) - (totals.get(a) ?? 0)));
	const config: ChartConfig = Object.fromEntries(
		ordered.map((k) => [k, { label: meta[k]?.label ?? k, color: meta[k]?.color ?? "#9ca3af" }]),
	);
	return (
		<Card>
			<CardHeader className="gap-0 pb-2">
				<CardTitle className="text-sm font-medium flex items-center gap-1.5">
					{title}
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">{tooltip}</TooltipContent>
					</Tooltip>
				</CardTitle>
			</CardHeader>
			<CardContent>
				<ChartContainer config={config} className="aspect-auto h-[200px] w-full">
					<AreaChart data={data} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
						<CartesianGrid vertical={false} strokeDasharray="3 3" />
						<XAxis
							dataKey="date"
							tickLine={false}
							axisLine={false}
							tickMargin={8}
							minTickGap={50}
							tick={{ fontSize: 11 }}
							tickFormatter={(value) => {
								const [year, month, day] = String(value).split("-").map(Number);
								const date = new Date(year, month - 1, day);
								return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
							}}
						/>
						<YAxis tickLine={false} axisLine={false} tickMargin={8} domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tick={{ fontSize: 11 }} tickFormatter={(value) => `${value}%`} />
						<ChartTooltip
							isAnimationActive={false}
							cursor={false}
							content={({ active, payload, label }) => {
								if (!active || !payload?.length) return null;
								const dp = payload[0]?.payload as Record<string, number | string> | undefined;
								const [year, month, day] = String(label).split("-").map(Number);
								const date = new Date(year, month - 1, day);
								const formattedDate = date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
								const rows = ordered
									.map((k) => ({ k, value: (dp?.[k] as number | undefined) ?? 0 }))
									.filter((r) => r.value > 0);
								return (
									<div className="border-border/50 bg-background grid min-w-[10rem] items-start gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
										<div className="font-medium">{formattedDate}</div>
										<div className="grid gap-1">
											{rows.map((r) => (
												<div key={r.k} className="flex items-center gap-2">
													<span className="shrink-0 rounded-[2px] h-2.5 w-2.5" style={{ backgroundColor: meta[r.k]?.color ?? "#9ca3af" }} />
													<span className="text-muted-foreground">{meta[r.k]?.label ?? r.k}</span>
													<span className="ml-auto font-mono tabular-nums">{r.value}%</span>
												</div>
											))}
										</div>
									</div>
								);
							}}
						/>
						{/* Render bottom-up (reverse of display order) so the largest band sits
						    on top and Other at the bottom; tooltip lists in the same order. */}
						{[...ordered].reverse().map((k) => (
							<Area key={k} dataKey={k} type="monotone" stackId="1" stroke={`var(--color-${k})`} fill={`var(--color-${k})`} fillOpacity={0.8} strokeWidth={0} />
						))}
					</AreaChart>
				</ChartContainer>
			</CardContent>
		</Card>
	);
}
