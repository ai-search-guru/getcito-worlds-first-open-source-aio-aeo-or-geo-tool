"use client";

import { useEffect, useRef } from "react";
import { cn } from "@workspace/ui/lib/utils";
import {
	AnchorProvider,
	ScrollProvider,
	TOCItem,
	useActiveAnchors,
	type TOCItemType,
} from "fumadocs-core/toc";
import { useOnChange } from "fumadocs-core/utils/use-on-change";

function TocThumb({
	containerRef,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
}) {
	const thumbRef = useRef<HTMLDivElement>(null);
	const active = useActiveAnchors();

	function update() {
		const container = containerRef.current;
		const element = thumbRef.current;
		if (!container || !element) return;

		if (active.length === 0 || container.clientHeight === 0) {
			element.style.setProperty("--toc-top", "0px");
			element.style.setProperty("--toc-height", "0px");
			return;
		}

		let upper = Number.MAX_VALUE;
		let lower = 0;
		for (const id of active) {
			const anchor = container.querySelector(`a[href="#${id}"]`);
			if (!anchor || !(anchor instanceof HTMLElement)) continue;
			const styles = getComputedStyle(anchor);
			upper = Math.min(
				upper,
				anchor.offsetTop + parseFloat(styles.paddingTop),
			);
			lower = Math.max(
				lower,
				anchor.offsetTop +
					anchor.clientHeight -
					parseFloat(styles.paddingBottom),
			);
		}

		element.style.setProperty("--toc-top", `${upper}px`);
		element.style.setProperty("--toc-height", `${lower - upper}px`);
	}

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;
		const observer = new ResizeObserver(update);
		observer.observe(container);
		return () => observer.disconnect();
	}, [containerRef]);

	useOnChange(active, update);

	return (
		<div
			ref={thumbRef}
			data-hidden={active.length === 0 || undefined}
			className="absolute top-[var(--toc-top)] h-[var(--toc-height)] w-0.5 rounded-full bg-primary transition-[top,height] duration-200 ease-linear data-[hidden]:opacity-0"
		/>
	);
}

function TocItems({ toc }: { toc: TOCItemType[] }) {
	const containerRef = useRef<HTMLDivElement>(null);

	return (
		<>
			<TocThumb containerRef={containerRef} />
			<div
				ref={containerRef}
				className="flex flex-col border-l border-border/50"
			>
				<ScrollProvider containerRef={containerRef}>
					{toc.map((item) => (
						<TOCItem
							key={item.url}
							href={item.url}
							className={cn(
								"block py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground data-[active=true]:text-primary data-[active=true]:font-medium",
								item.depth <= 2 && "ps-3",
								item.depth === 3 && "ps-6",
								item.depth >= 4 && "ps-8",
							)}
						>
							{item.title}
						</TOCItem>
					))}
				</ScrollProvider>
			</div>
		</>
	);
}

export function DocsToc({ toc }: { toc: TOCItemType[] }) {
	if (toc.length === 0) return null;

	return (
		<AnchorProvider toc={toc}>
			<div className="space-y-2">
				<p className="text-sm font-medium">On this page</p>
				<div className="relative">
					<TocItems toc={toc} />
				</div>
			</div>
		</AnchorProvider>
	);
}
