import { useCallback, useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { type LookbackPeriod, getDefaultLookbackPeriod } from "@/lib/chart-utils";
import { useBrand } from "@/hooks/use-brands";
import { ALL_MODELS_VALUE } from "@/lib/model-filter";

/** The shared dashboard filter params. Validated once at the `$brand` layout
 *  route (`validateSearch: validateBrandFilterSearch`) so every child route
 *  inherits them and links/filtered views stay shareable. `tags` stays a
 *  comma-joined string in the URL (the format our old nuqs links used);
 *  consumers split/join via `splitTags`/`joinTags`. */
export type BrandFilterSearch = {
	model?: string;
	lookback?: string;
	tags?: string;
	q?: string;
};

// The router's default search parser JSON-parses each value, so `?q=123`
// arrives as a number and a stale `?tags=["a","b"]` link as an array.
// Normalize everything back to plain strings; absent/empty means "no filter".
function asString(value: unknown): string | undefined {
	if (typeof value === "string") return value || undefined;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	return undefined;
}

export function validateBrandFilterSearch(search: Record<string, unknown>): BrandFilterSearch {
	return {
		model: asString(search.model),
		lookback: asString(search.lookback),
		tags: Array.isArray(search.tags) ? search.tags.map(String).join(",") : asString(search.tags),
		q: asString(search.q),
	};
}

export function splitTags(tags: string | undefined): string[] {
	return tags ? tags.split(",").filter(Boolean) : [];
}

export function joinTags(tags: readonly string[]): string | undefined {
	return tags.length > 0 ? tags.join(",") : undefined;
}

const LOOKBACK_VALUES = ["1w", "1m", "3m", "6m", "1y", "all"] as const;
export function coerceLookback(
	raw: string | null | undefined,
	fallback: LookbackPeriod,
): LookbackPeriod {
	return (LOOKBACK_VALUES as readonly string[]).includes(raw ?? "")
		? (raw as LookbackPeriod)
		: fallback;
}

/** Write side of the filter URL state: one router navigation per interaction
 *  (`replace`, no scroll reset, so filter clicks never grow history or jump
 *  the page). Setting a key to `undefined` removes it from the URL — pass
 *  that for a filter's default value so default state keeps a clean URL. */
export function useFilterNavigate() {
	const navigate = useNavigate();
	return useCallback(
		(updates: Partial<BrandFilterSearch>) =>
			navigate({
				to: ".",
				search: (prev: Record<string, unknown>) => ({ ...prev, ...updates }),
				replace: true,
				resetScroll: false,
			}),
		[navigate],
	);
}

/** URL-persisted state for the standard dashboard filter set (search, tags,
 *  model, lookback). Page-specific keys (e.g. the fan-out `tab`) live in
 *  their own route's `validateSearch` instead.
 *
 *  This subscribes to the whole search object — use it in the component that
 *  composes the page's data query. Display widgets (the filter-bar dropdowns)
 *  keep their own per-key `useSearch` selectors so a lookback click doesn't
 *  re-render the whole bar. */
export function useListFilters() {
	const { brand } = useBrand();
	const defaultLookback = useMemo(
		() => getDefaultLookbackPeriod(brand?.earliestDataDate),
		[brand?.earliestDataDate],
	);

	const urlFilters: BrandFilterSearch = useSearch({ strict: false });
	const setFilters = useFilterNavigate();

	const model = urlFilters.model ?? ALL_MODELS_VALUE;
	const tags = useMemo(() => splitTags(urlFilters.tags), [urlFilters.tags]);
	const search = urlFilters.q ?? "";

	return {
		model,
		lookback: coerceLookback(urlFilters.lookback, defaultLookback),
		tags,
		search,
		/** True when any narrowing filter is active (lookback never narrows to
		 *  zero on its own, so it doesn't count). Gates which empty state a
		 *  page shows: "no data" vs "no matches for your filters". */
		isFiltered: Boolean(search) || tags.length > 0 || model !== ALL_MODELS_VALUE,
		clearFilters: () => setFilters({ q: undefined, tags: undefined, model: undefined }),
	};
}

/** The shell only reads this subset of `useListFilters()`'s return. */
export interface ListFilterState {
	isFiltered: boolean;
	clearFilters: () => void;
}
