import type { ReactNode } from "react";
import { Inbox } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { FilterBar } from "@/components/filter-bar";
import { FilterSection } from "@/components/page-header";
import type { ListFilterState } from "@/hooks/use-list-filters";

interface FilteredListShellProps {
	/** The page's `useListFilters()` result. */
	filters: ListFilterState;
	availableTags: readonly string[];
	availableModels: string[];
	showSearch?: boolean;
	showModelSelector?: boolean;
	/** Show "n results" / "n of m results" next to the filter dropdowns. */
	showResultCount?: boolean;
	/** Page-specific controls rendered inline with the filter-bar dropdown
	 *  group (e.g. the prompts list's sort dropdown). */
	filterBarExtras?: ReactNode;
	/** Extra content inside the sticky filter section, below the bar
	 *  (e.g. the visibility bar on the prompts page). */
	filterSectionExtras?: ReactNode;
	isLoading?: boolean;
	loadingState?: ReactNode;
	isError?: boolean;
	errorState?: ReactNode;
	/** UNFILTERED result count. The "truly empty" vs "no matches" decision
	 *  keys off this plus `filters.isFiltered` — never off the filtered
	 *  count, which is the class of bug behind #322 (sections vanishing
	 *  because a search filtered them to zero). */
	totalCount: number | undefined;
	/** Count after client-side filtering. Defaults to `totalCount` for pages
	 *  whose filters are applied server-side. */
	filteredCount?: number;
	/** Shown when there is no data at all (no narrowing filters active). */
	emptyState: ReactNode;
	noMatchesTitle?: string;
	noMatchesDescription?: string;
	children: ReactNode;
}

/** The "FilterBar → fetch → filter → list" composition every dashboard page
 *  was rebuilding by hand: filter bar + result count, the loading/error
 *  states, and the two DISTINCT empty states ("no data yet" vs "no matches
 *  for your filters" with a Clear filters escape hatch). The page keeps
 *  owning data fetching; the shell owns the plumbing around it. */
export function FilteredListShell({
	filters,
	availableTags,
	availableModels,
	showSearch = false,
	showModelSelector = true,
	showResultCount = false,
	filterBarExtras,
	filterSectionExtras,
	isLoading = false,
	loadingState,
	isError = false,
	errorState,
	totalCount,
	filteredCount,
	emptyState,
	noMatchesTitle,
	noMatchesDescription,
	children,
}: FilteredListShellProps) {
	const effectiveFilteredCount = filteredCount ?? totalCount;

	let body: ReactNode;
	if (isLoading) {
		body = loadingState;
	} else if (isError) {
		body = errorState;
	} else if ((totalCount ?? 0) === 0 && !filters.isFiltered) {
		body = emptyState;
	} else if ((effectiveFilteredCount ?? 0) === 0) {
		body = (
			<div className="border-2 border-dashed border-muted rounded-lg min-h-48 flex items-center justify-center">
				<div className="text-center py-8 text-muted-foreground">
					<Inbox className="h-12 w-12 mx-auto mb-4 opacity-50" />
					<p className="mb-2">{noMatchesTitle ?? "No results match your filters."}</p>
					<p className="text-sm mb-4">
						{noMatchesDescription ?? "Try adjusting your search or filters."}
					</p>
					<Button
						variant="outline"
						size="sm"
						onClick={filters.clearFilters}
						className="cursor-pointer"
					>
						Clear filters
					</Button>
				</div>
			</div>
		);
	} else {
		body = children;
	}

	return (
		<>
			<FilterSection>
				<FilterBar
					availableTags={availableTags}
					availableModels={availableModels}
					showSearch={showSearch}
					showModelSelector={showModelSelector}
					resultCount={showResultCount && !isLoading ? effectiveFilteredCount : undefined}
					resultTotal={showResultCount && !isLoading ? totalCount : undefined}
					extraControls={filterBarExtras}
				/>
				{filterSectionExtras}
			</FilterSection>
			<div className="space-y-6">{body}</div>
		</>
	);
}
