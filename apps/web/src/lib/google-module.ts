/**
 * Google AI Mode module builder.
 *
 * Shopping product cards and search links Google AI Mode surfaces aren't external
 * citations in the traditional sense (they point back into Google's own results),
 * so they're pulled OUT of the citation source mix and surfaced here instead —
 * products attributed brand-vs-competitor by name, and searches, each tied to the
 * prompts that triggered them. Shared by the brand-wide citations view and the
 * per-prompt detail view so both render the same Google Shopping section.
 */
import {
	type ProductAttribution,
	isGoogleShoppingUrl,
	isGoogleSearchUrl,
	parseGoogleProductName,
	parseGoogleSearchQuery,
	attributeProduct,
} from "@/lib/domain-categories";

/** Minimal per-prompt cited-page row this builder needs (a structural subset of
 *  `PerPromptCitationPageRow`). */
export interface GoogleModulePageRow {
	prompt_id: string;
	url: string | null;
	domain: string;
	title: string | null;
	count: number;
}

export type GooglePromptRef = { id: string; value: string; count: number };
export type GoogleProduct = {
	name: string;
	count: number;
	attribution: ProductAttribution["kind"];
	competitorName?: string;
	prompts: GooglePromptRef[];
	urls: { url: string; count: number }[];
};
export type GoogleQuery = { query: string; count: number; prompts: GooglePromptRef[] };
export type GoogleModule = {
	shopping: { totalCitations: number; brandCount: number; competitorCount: number; products: GoogleProduct[] };
	search: { totalCitations: number; queries: GoogleQuery[] };
};

export const emptyGoogleModule = (): GoogleModule => ({
	shopping: { totalCitations: 0, brandCount: 0, competitorCount: 0, products: [] },
	search: { totalCitations: 0, queries: [] },
});

/**
 * Build the Google AI Mode module from per-prompt cited pages: Shopping products
 * (attributed brand/competitor/other by name) and search queries, each tied to
 * the prompts that triggered them.
 */
export function buildGoogleModule(
	pages: GoogleModulePageRow[],
	brandName: string,
	competitors: { id: string; name: string }[],
	promptValue: (id: string) => string | undefined,
): GoogleModule {
	type ProductAgg = { name: string; count: number; attribution: ProductAttribution; prompts: Map<string, number>; urls: Map<string, number> };
	type QueryAgg = { query: string; count: number; prompts: Map<string, number> };
	const productByKey = new Map<string, ProductAgg>();
	const queryByKey = new Map<string, QueryAgg>();

	for (const row of pages) {
		if (!row.url) continue;
		const c = Number(row.count);
		if (isGoogleShoppingUrl(row.url)) {
			const name = parseGoogleProductName(row.url, row.title);
			if (!name) continue;
			const key = name.toLowerCase();
			let e = productByKey.get(key);
			if (!e) {
				e = { name, count: 0, attribution: attributeProduct(name, brandName, competitors), prompts: new Map(), urls: new Map() };
				productByKey.set(key, e);
			}
			e.count += c;
			e.prompts.set(row.prompt_id, (e.prompts.get(row.prompt_id) ?? 0) + c);
			e.urls.set(row.url, (e.urls.get(row.url) ?? 0) + c);
		} else if (isGoogleSearchUrl(row.url)) {
			const query = parseGoogleSearchQuery(row.url);
			if (!query) continue;
			const key = query.toLowerCase();
			let e = queryByKey.get(key);
			if (!e) {
				e = { query, count: 0, prompts: new Map() };
				queryByKey.set(key, e);
			}
			e.count += c;
			e.prompts.set(row.prompt_id, (e.prompts.get(row.prompt_id) ?? 0) + c);
		}
	}

	const promptRefs = (m: Map<string, number>): GooglePromptRef[] =>
		[...m.entries()]
			.map(([id, count]) => {
				const value = promptValue(id);
				return value ? { id, value, count } : null;
			})
			.filter((p): p is GooglePromptRef => p !== null)
			.sort((a, b) => b.count - a.count);

	const products: GoogleProduct[] = [...productByKey.values()]
		.map((e) => ({
			name: e.name,
			count: e.count,
			attribution: e.attribution.kind,
			competitorName: e.attribution.kind === "competitor" ? e.attribution.competitorName : undefined,
			prompts: promptRefs(e.prompts),
			urls: [...e.urls.entries()].map(([url, count]) => ({ url, count })).sort((a, b) => b.count - a.count),
		}))
		.sort((a, b) => b.count - a.count);

	const queries: GoogleQuery[] = [...queryByKey.values()]
		.map((e) => ({ query: e.query, count: e.count, prompts: promptRefs(e.prompts) }))
		.sort((a, b) => b.count - a.count);

	const brandCount = products.filter((p) => p.attribution === "brand").reduce((s, p) => s + p.count, 0);
	const competitorCount = products.filter((p) => p.attribution === "competitor").reduce((s, p) => s + p.count, 0);

	return {
		shopping: {
			totalCitations: products.reduce((s, p) => s + p.count, 0),
			brandCount,
			competitorCount,
			products,
		},
		search: {
			totalCitations: queries.reduce((s, q) => s + q.count, 0),
			queries,
		},
	};
}
