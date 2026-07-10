/**
 * Dependency-free term cloud. Sizes each term by sqrt(count) (so a 100× term
 * isn't 100× the height), colors it by frequency, and centers the biggest terms
 * so it reads like a cloud rather than a sorted list. Deterministic — no random
 * placement — so it's SSR-stable.
 */
import { cn } from "@workspace/ui/lib/utils";

export interface WordCloudTerm {
	term: string;
	count: number;
}

// Frequent → rare. Index 0 is for the biggest terms.
const PALETTE = [
	"#7c3aed", // violet
	"#4f46e5", // indigo
	"#2563eb", // blue
	"#0891b2", // cyan
	"#0d9488", // teal
	"#059669", // emerald
	"#d97706", // amber
];

const MIN_PX = 13;
const MAX_PX = 40;

export function WordCloud({
	terms,
	maxItems = 48,
	className,
}: {
	terms: WordCloudTerm[];
	maxItems?: number;
	className?: string;
}) {
	// Sort here rather than relying on the caller: slicing the top terms and the
	// center-weighted ordering below both assume descending counts.
	const items = [...terms].sort((a, b) => b.count - a.count).slice(0, maxItems);
	if (items.length === 0) {
		return <div className="text-muted-foreground py-6 text-center text-sm">No terms for this period.</div>;
	}

	const counts = items.map((i) => i.count);
	const max = Math.max(...counts);
	const min = Math.min(...counts);
	const rootMax = Math.sqrt(max);
	const rootMin = Math.sqrt(min);
	const scale = (count: number) => (max === min ? 0.6 : (Math.sqrt(count) - rootMin) / (rootMax - rootMin)); // 0..1

	// Center-weight: place the largest terms toward the middle so wrapping reads
	// like a cloud (big in the core, small at the edges) instead of top-left heavy.
	const ordered: WordCloudTerm[] = [];
	items.forEach((it, i) => {
		if (i % 2 === 0) ordered.push(it);
		else ordered.unshift(it);
	});

	return (
		<div className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1 leading-tight", className)}>
			{ordered.map((it) => {
				const t = scale(it.count);
				const color = PALETTE[Math.min(PALETTE.length - 1, Math.round((1 - t) * (PALETTE.length - 1)))];
				return (
					<span
						key={it.term}
						title={`${it.term} · ${it.count.toLocaleString()}`}
						className="font-semibold"
						style={{ fontSize: Math.round(MIN_PX + t * (MAX_PX - MIN_PX)), color, opacity: 0.62 + t * 0.38 }}
					>
						{it.term}
					</span>
				);
			})}
		</div>
	);
}
