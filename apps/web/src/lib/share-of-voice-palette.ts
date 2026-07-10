/**
 * Shared Share-of-Voice palette so the donut and the leaderboard colour each
 * brand identically — the brand in its blue, competitors from a fixed palette in
 * rank order, and the long tail in a neutral "others" grey.
 */
export const BRAND_COLOR = "#2563eb";
export const OTHERS_COLOR = "#cbd5e1";
export const COMPETITOR_PALETTE = ["#10b981", "#f59e0b", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];

interface BrandLike {
	name: string;
	isBrand: boolean;
	mentions: number;
}

/**
 * Map each entry name to its colour, mirroring the donut's assignment order
 * (brand → BRAND_COLOR; the first `topN` competitors → palette; the rest →
 * OTHERS_COLOR). Entries with no mentions are skipped, matching the donut.
 */
export function shareOfVoiceColorMap(entries: BrandLike[], topN = 6): Map<string, string> {
	const map = new Map<string, string>();
	let competitorIdx = 0;
	for (const e of entries) {
		if (e.mentions <= 0) continue;
		if (e.isBrand) {
			map.set(e.name, BRAND_COLOR);
		} else if (competitorIdx < topN) {
			map.set(e.name, COMPETITOR_PALETTE[competitorIdx++ % COMPETITOR_PALETTE.length]);
		} else {
			map.set(e.name, OTHERS_COLOR);
		}
	}
	return map;
}
