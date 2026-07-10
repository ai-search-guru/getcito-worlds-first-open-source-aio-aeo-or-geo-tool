
import { memo, useRef, useMemo, useState, useCallback, useLayoutEffect, useEffect } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CachedPromptChart } from "./cached-prompt-chart";
import type { LookbackPeriod } from "@/hooks/use-prompt-chart-data";

interface PromptItem {
	id: string;
	value: string;
	// All-time first evaluation date (null if never evaluated)
	// Note: Date objects are serialized to strings in JSON responses
	firstEvaluatedAt?: Date | string | null;
}

interface VirtualizedPromptListProps {
	prompts: PromptItem[];
	brandId: string;
	lookback: LookbackPeriod;
	/** Current model filter ("all" means no filter). */
	selectedModel: string;
	/** Concrete model ids this brand runs — no "all" sentinel. */
	availableModels: string[];
	searchHighlight?: string;
}

// All chart cards use a uniform height (empty states match chart height via h-[250px])
const CHART_CARD_HEIGHT = 380;
const CHART_GAP = 24; // px - gap between cards (space-y-6)

// Memoized so react-query `isFetching` state changes on the parent
// (which re-render prompts-display but leave these props untouched) don't
// cascade into 30+ CachedPromptChart re-renders.
export const VirtualizedPromptList = memo(function VirtualizedPromptList({
	prompts,
	brandId,
	lookback,
	selectedModel,
	availableModels,
	searchHighlight = "",
}: VirtualizedPromptListProps) {
	const listRef = useRef<HTMLDivElement>(null);
	const [scrollMargin, setScrollMargin] = useState(0);

	const orderedPrompts = prompts;

	// Measure the offset of the list from the top of the page
	useLayoutEffect(() => {
		if (listRef.current) {
			setScrollMargin(listRef.current.offsetTop);
		}
	}, []);

	// Create a stable key that changes when the prompts list changes
	const promptsKey = useMemo(() => {
		return orderedPrompts.map(p => p.id).join(",");
	}, [orderedPrompts]);

	// Uniform height estimate — all cards (loading, empty, full) have matching content areas
	const estimateSize = useCallback(() => CHART_CARD_HEIGHT + CHART_GAP, []);

	const virtualizer = useWindowVirtualizer({
		count: orderedPrompts.length,
		estimateSize,
		overscan: 3, // Render 3 extra items above and below viewport
		scrollMargin,
	});

	// Force virtualizer to recalculate when prompts list changes (e.g., after filtering)
	useEffect(() => {
		const timer = setTimeout(() => {
			virtualizer.measure();
		}, 50);
		return () => clearTimeout(timer);
	}, [virtualizer, promptsKey]);

	const virtualItems = virtualizer.getVirtualItems();

	return (
		<div ref={listRef} className="space-y-6">
			<div
				style={{
					height: `${virtualizer.getTotalSize()}px`,
					width: "100%",
					position: "relative",
				}}
			>
				{virtualItems.map((virtualItem) => {
					const prompt = orderedPrompts[virtualItem.index];

					return (
						<div
							key={prompt.id}
							data-index={virtualItem.index}
							ref={virtualizer.measureElement}
							style={{
								position: "absolute",
								top: 0,
								left: 0,
								width: "100%",
								transform: `translateY(${virtualItem.start - scrollMargin}px)`,
								contain: "layout style",
							}}
						>
							<div style={{ paddingBottom: CHART_GAP }}>
								<CachedPromptChart
									promptId={prompt.id}
									promptName={prompt.value}
									brandId={brandId}
									lookback={lookback}
									selectedModel={selectedModel}
									availableModels={availableModels}
									searchHighlight={searchHighlight}
									hasEverBeenEvaluated={Boolean(prompt.firstEvaluatedAt)}
								/>
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
});
