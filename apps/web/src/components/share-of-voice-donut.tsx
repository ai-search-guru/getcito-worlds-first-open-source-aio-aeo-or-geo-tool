/**
 * Donut of share of voice: the brand plus its top competitors, with the long
 * tail bucketed into "Others". Sits beside the headline share number.
 */
import { Cell, Pie, PieChart, Tooltip } from "recharts";
import { ChartContainer } from "@workspace/ui/components/chart";
import type { ShareOfVoiceEntry } from "@/server/analysis";
import { BRAND_COLOR, COMPETITOR_PALETTE as PALETTE, OTHERS_COLOR } from "@/lib/share-of-voice-palette";

interface Slice {
	name: string;
	value: number;
	color: string;
}

export function ShareOfVoiceDonut({ entries, topN = 6 }: { entries: ShareOfVoiceEntry[]; topN?: number }) {
	const slices: Slice[] = [];
	let paletteIdx = 0;
	let shownCompetitors = 0;
	let othersValue = 0;

	for (const e of entries) {
		if (e.mentions <= 0) continue;
		if (e.isBrand) {
			slices.push({ name: e.name, value: e.mentions, color: BRAND_COLOR });
		} else if (shownCompetitors < topN) {
			slices.push({ name: e.name, value: e.mentions, color: PALETTE[paletteIdx++ % PALETTE.length] });
			shownCompetitors++;
		} else {
			othersValue += e.mentions;
		}
	}
	if (othersValue > 0) slices.push({ name: "Others", value: othersValue, color: OTHERS_COLOR });

	const total = slices.reduce((s, x) => s + x.value, 0);
	if (total === 0) return null;

	return (
		<ChartContainer config={{}} className="aspect-square h-[180px] w-[180px]">
			<PieChart>
				<Pie data={slices} dataKey="value" nameKey="name" innerRadius={48} outerRadius={84} paddingAngle={1} strokeWidth={1}>
					{slices.map((s) => (
						<Cell key={s.name} fill={s.color} />
					))}
				</Pie>
				<Tooltip
					content={({ active, payload }) => {
						if (!active || !payload?.length) return null;
						const s = payload[0].payload as Slice;
						return (
							<div className="rounded-md border bg-background px-2 py-1 text-xs shadow-md">
								{s.name}: {Math.round((s.value / total) * 100)}%
							</div>
						);
					}}
				/>
			</PieChart>
		</ChartContainer>
	);
}
