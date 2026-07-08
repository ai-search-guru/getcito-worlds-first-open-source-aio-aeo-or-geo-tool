/**
 * Pure, dependency-free statistics for AI-visibility analysis.
 *
 * These power the Share of Voice page and the Opportunities digest's stability
 * scores. They take plain aggregated rows (produced by the
 * postgres read layer) and never touch IO, so they are unit-testable in
 * isolation.
 *
 * Two notions of "how much do the cited sources move over time" live here and
 * are deliberately kept distinct — in practice they are near-orthogonal:
 *   - set volatility:      churn in the *set* of cited domains (Jaccard distance).
 *   - weighted volatility: churn weighted by citation *volume* (Bray–Curtis on
 *     the daily citation-share vectors). A prompt with one dominant source every
 *     day but a noisy long tail looks volatile by set yet stable by volume —
 *     weighted is the truer "do the sources that carry the answer move?" signal,
 *     so it's the one we surface as the Stability score.
 */

export interface DailyDomainCount {
	/** ISO day bucket, "YYYY-MM-DD" (lexicographically sortable = chronological). */
	date: string;
	domain: string;
	/** Number of citations to `domain` on `date`. */
	count: number;
}

export interface VolatilityResult {
	/** Mean Jaccard distance between consecutive days' domain sets, 0..1. null if < 2 days of data. */
	setVolatility: number | null;
	/** Mean Bray–Curtis distance between consecutive days' citation-share vectors, 0..1. null if < 2 days. */
	weightedVolatility: number | null;
	/** Consecutive-day transitions the averages are based on. Use as a reliability gate. */
	dayTransitions: number;
}

interface DayBucket {
	date: string;
	counts: Map<string, number>;
	total: number;
}

const round3 = (x: number): number => Math.round(x * 1000) / 1000;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Collapse raw rows into one bucket per day (summing duplicate domains), sorted chronologically. */
function bucketByDay(daily: DailyDomainCount[]): DayBucket[] {
	const byDate = new Map<string, Map<string, number>>();
	for (const { date, domain, count } of daily) {
		if (count <= 0) continue;
		let m = byDate.get(date);
		if (!m) {
			m = new Map();
			byDate.set(date, m);
		}
		m.set(domain, (m.get(domain) ?? 0) + count);
	}
	return [...byDate.entries()]
		.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		.map(([date, counts]) => {
			let total = 0;
			for (const c of counts.values()) total += c;
			return { date, counts, total };
		});
}

/**
 * Citation volatility: how much the cited-domain set churns from one day to the next.
 * Returns both the unweighted (set) and volume-weighted distances, averaged over
 * every consecutive-day transition.
 */
export function computeVolatility(daily: DailyDomainCount[]): VolatilityResult {
	const days = bucketByDay(daily);
	if (days.length < 2) {
		return { setVolatility: null, weightedVolatility: null, dayTransitions: 0 };
	}

	let setSum = 0;
	let weightedSum = 0;
	let transitions = 0;

	for (let i = 1; i < days.length; i++) {
		const prev = days[i - 1];
		const cur = days[i];

		// Jaccard distance on the domain sets: 1 - |A∩B| / |A∪B|.
		let inter = 0;
		for (const d of cur.counts.keys()) {
			if (prev.counts.has(d)) inter++;
		}
		const union = cur.counts.size + prev.counts.size - inter;
		const setDist = union === 0 ? 0 : 1 - inter / union;

		// Bray–Curtis distance on the citation-share vectors: 1 - Σ min(shareCur, sharePrev).
		// Domains present on only one of the two days contribute min(x, 0) = 0, so we only
		// need to walk the shared domains.
		let overlap = 0;
		for (const [d, c] of cur.counts) {
			const prevC = prev.counts.get(d);
			if (prevC === undefined) continue;
			overlap += Math.min(c / cur.total, prevC / prev.total);
		}
		const weightedDist = 1 - overlap;

		setSum += setDist;
		weightedSum += weightedDist;
		transitions++;
	}

	return {
		setVolatility: round3(setSum / transitions),
		weightedVolatility: round3(weightedSum / transitions),
		dayTransitions: transitions,
	};
}

/** Product-facing Stability score: 0 (churns daily) → 100 (rock stable). null if not enough data. */
export function stabilityScore(weightedVolatility: number | null): number | null {
	if (weightedVolatility === null) return null;
	return Math.round((1 - clamp01(weightedVolatility)) * 100);
}

export interface VoiceShare {
	name: string;
	/** Run-days (or runs) on which this entity was mentioned. */
	mentions: number;
	/** Share of total mentions across the brand + all competitors, 0..1. Exact
	 * ratio (not pre-rounded) — round once at the display layer so the table,
	 * donut, and trend never disagree by a point. */
	share: number;
	isBrand: boolean;
}

/**
 * Share of voice across the brand and its competitors. Inputs must be in a
 * consistent unit (e.g. "# of runs that mentioned this entity"), so the brand's
 * mention count and each competitor's are directly comparable.
 *
 * `share`/`brandShare` are exact ratios, deliberately NOT pre-rounded: the
 * leaderboard renders `round(share * 100)`, the donut `round(mentions / total *
 * 100)`, and the trend `round(brand / denom * 100)` — all the same single round
 * of the same ratio. Pre-rounding `share` here (e.g. to 3 decimals) would
 * double-round and let the table read a point off the headline/donut.
 */
export function computeShareOfVoice(
	brand: { name: string; mentions: number },
	competitors: { name: string; mentions: number }[],
): { entries: VoiceShare[]; brandShare: number | null; total: number } {
	let total = brand.mentions;
	for (const c of competitors) total += c.mentions;
	const mk = (name: string, mentions: number, isBrand: boolean): VoiceShare => ({
		name,
		mentions,
		isBrand,
		share: total === 0 ? 0 : mentions / total,
	});
	const entries = [mk(brand.name, brand.mentions, true), ...competitors.map((c) => mk(c.name, c.mentions, false))].sort(
		(a, b) => b.mentions - a.mentions,
	);
	return { entries, brandShare: total === 0 ? null : brand.mentions / total, total };
}

export interface PerPromptDailyMentions {
	promptId: string;
	date: string;
	brandMentions: number;
	competitorMentions: number;
}

/**
 * Brand share of voice over time, smoothed with per-prompt Last-Value-Carried-
 * Forward (mirrors the visibility trend): each prompt's last-known brand and
 * competitor mention counts are carried across days it didn't run, then summed
 * per day — so staggered prompt schedules don't scallop the line. The carry is
 * pre-seeded with each prompt's earliest observation to avoid a ramp-up dip.
 * Share = brand / (brand + competitor), as a 0–100 percentage (null = no data).
 */
export function shareOfVoiceTimeSeriesLVCF(
	perPrompt: PerPromptDailyMentions[],
	dateRange: string[],
): Array<{ date: string; share: number | null }> {
	const byPrompt = new Map<string, Map<string, { brand: number; competitor: number }>>();
	for (const r of perPrompt) {
		let m = byPrompt.get(r.promptId);
		if (!m) {
			m = new Map();
			byPrompt.set(r.promptId, m);
		}
		m.set(r.date, { brand: r.brandMentions, competitor: r.competitorMentions });
	}

	const daily = new Map<string, { brand: number; competitor: number }>();
	for (const [, dateMap] of byPrompt) {
		const sorted = [...dateMap.entries()].sort(([a], [b]) => a.localeCompare(b));
		let carried = sorted.length > 0 ? sorted[0][1] : null;
		for (const date of dateRange) {
			const actual = dateMap.get(date);
			if (actual) carried = actual;
			if (!carried) continue;
			let bucket = daily.get(date);
			if (!bucket) {
				bucket = { brand: 0, competitor: 0 };
				daily.set(date, bucket);
			}
			bucket.brand += carried.brand;
			bucket.competitor += carried.competitor;
		}
	}

	return dateRange.map((date) => {
		const b = daily.get(date);
		if (!b) return { date, share: null };
		const denom = b.brand + b.competitor;
		return { date, share: denom === 0 ? null : Math.round((b.brand / denom) * 100) };
	});
}

export interface LeaderboardLVCFResult {
	brandMentions: number;
	brandPrompts: number;
	competitors: Array<{ name: string; mentions: number; prompts: number }>;
}

/**
 * "Current standings" leaderboard: carry each prompt's most recent (brand +
 * per-competitor) mention counts forward to the last day, then sum across
 * prompts. This is the per-competitor companion to shareOfVoiceTimeSeriesLVCF
 * and uses the same per-prompt last-observation carry-forward, so the brand
 * share it implies equals that trend's final point — keeping the headline,
 * donut, and table consistent with the line (rather than a whole-window
 * aggregate that wouldn't match it).
 */
export function shareOfVoiceLeaderboardLVCF(
	brandDaily: Array<{ promptId: string; date: string; brand: number }>,
	competitorDaily: Array<{ promptId: string; date: string; competitor: string; mentions: number }>,
	dateRange: string[],
): LeaderboardLVCFResult {
	if (dateRange.length === 0) return { brandMentions: 0, brandPrompts: 0, competitors: [] };
	const lastDate = dateRange[dateRange.length - 1];

	interface Obs {
		brand: number;
		competitors: Map<string, number>;
	}
	const byPrompt = new Map<string, Map<string, Obs>>();
	const obsAt = (promptId: string, date: string): Obs => {
		let dateMap = byPrompt.get(promptId);
		if (!dateMap) {
			dateMap = new Map();
			byPrompt.set(promptId, dateMap);
		}
		let obs = dateMap.get(date);
		if (!obs) {
			obs = { brand: 0, competitors: new Map() };
			dateMap.set(date, obs);
		}
		return obs;
	};
	for (const r of brandDaily) obsAt(r.promptId, r.date).brand = r.brand;
	for (const r of competitorDaily) {
		if (r.mentions > 0) obsAt(r.promptId, r.date).competitors.set(r.competitor, r.mentions);
	}

	let brandMentions = 0;
	let brandPrompts = 0;
	const compMentions = new Map<string, number>();
	const compPrompts = new Map<string, number>();

	for (const [, dateMap] of byPrompt) {
		// The prompt's latest observation on/before the last day = its current state.
		let last: Obs | null = null;
		let lastSeen = "";
		for (const [date, obs] of dateMap) {
			if (date <= lastDate && date >= lastSeen) {
				last = obs;
				lastSeen = date;
			}
		}
		if (!last) continue;
		brandMentions += last.brand;
		if (last.brand > 0) brandPrompts++;
		for (const [name, n] of last.competitors) {
			if (n <= 0) continue;
			compMentions.set(name, (compMentions.get(name) ?? 0) + n);
			compPrompts.set(name, (compPrompts.get(name) ?? 0) + 1);
		}
	}

	const competitors = [...compMentions.entries()]
		.map(([name, mentions]) => ({ name, mentions, prompts: compPrompts.get(name) ?? 0 }))
		.sort((a, b) => b.mentions - a.mentions);

	return { brandMentions, brandPrompts, competitors };
}
