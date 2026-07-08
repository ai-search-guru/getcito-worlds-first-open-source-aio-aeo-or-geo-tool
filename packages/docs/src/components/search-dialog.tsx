"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useDocsSearch } from "fumadocs-core/search/client";
import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@workspace/ui/components/dialog";
import { cn } from "@workspace/ui/lib/utils";
import { Search, FileText, Hash, Text } from "lucide-react";
import type { SortedResult } from "fumadocs-core/search";

function ResultIcon({ type }: { type: SortedResult["type"] }) {
	switch (type) {
		case "page":
			return <FileText className="size-4 shrink-0 text-muted-foreground" />;
		case "heading":
			return <Hash className="size-4 shrink-0 text-muted-foreground" />;
		case "text":
			return <Text className="size-4 shrink-0 text-muted-foreground" />;
	}
}

export function SearchDialog({
	open,
	onOpenChange,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const navigate = useNavigate();
	const { search, setSearch, query } = useDocsSearch({
		type: "fetch",
	});
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const results =
		query.data && query.data !== "empty" ? query.data : [];

	useEffect(() => {
		setActiveIndex(0);
	}, [search]);

	useEffect(() => {
		if (open) {
			setTimeout(() => inputRef.current?.focus(), 0);
		} else {
			setSearch("");
			setActiveIndex(0);
		}
	}, [open, setSearch]);

	const handleSelect = useCallback(
		(url: string) => {
			onOpenChange(false);
			navigate({ to: url });
		},
		[navigate, onOpenChange],
	);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "ArrowDown") {
				e.preventDefault();
				setActiveIndex((i) => Math.min(i + 1, results.length - 1));
			} else if (e.key === "ArrowUp") {
				e.preventDefault();
				setActiveIndex((i) => Math.max(i - 1, 0));
			} else if (e.key === "Enter" && results[activeIndex]) {
				e.preventDefault();
				handleSelect(results[activeIndex].url);
			}
		},
		[results, activeIndex, handleSelect],
	);

	useEffect(() => {
		const active = listRef.current?.querySelector(
			`[data-index="${activeIndex}"]`,
		);
		active?.scrollIntoView({ block: "nearest" });
	}, [activeIndex]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent
				showCloseButton={false}
				className="gap-0 overflow-hidden p-0 sm:max-w-lg"
				aria-describedby={undefined}
			>
				<DialogTitle className="sr-only">Search documentation</DialogTitle>
				<div className="flex items-center gap-2 border-b px-3">
					<Search className="size-4 shrink-0 text-muted-foreground" />
					<input
						ref={inputRef}
						value={search}
						onChange={(e) => setSearch(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Search docs..."
						className="flex-1 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
					/>
					<kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground sm:inline-block">
						ESC
					</kbd>
				</div>
				<div
					ref={listRef}
					className="max-h-80 overflow-y-auto"
				>
					{query.isLoading && search.length > 0 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							Searching...
						</div>
					)}
					{!query.isLoading && search.length > 0 && results.length === 0 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							No results found for &ldquo;{search}&rdquo;
						</div>
					)}
					{results.length > 0 && (
						<ul className="p-1">
							{results.map((result, index) => (
								<li key={result.id}>
									<button
										type="button"
										data-index={index}
										onClick={() => handleSelect(result.url)}
										className={cn(
											"flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
											index === activeIndex
												? "bg-accent text-accent-foreground"
												: "hover:bg-accent/50",
										)}
									>
										<ResultIcon type={result.type} />
										<div className="min-w-0 flex-1">
											<span
												className="block truncate font-medium [&_mark]:bg-primary/20 [&_mark]:text-foreground [&_mark]:rounded-sm [&_mark]:px-0.5"
												dangerouslySetInnerHTML={{
													__html: String(result.content),
												}}
											/>
											{result.breadcrumbs &&
												result.breadcrumbs.length > 0 && (
													<span className="block truncate text-xs text-muted-foreground">
														{result.breadcrumbs.join(" > ")}
													</span>
												)}
										</div>
									</button>
								</li>
							))}
						</ul>
					)}
					{search.length === 0 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							Type to search documentation
						</div>
					)}
				</div>
				<div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
					<span>
						<kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↑</kbd>{" "}
						<kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↓</kbd>{" "}
						to navigate
					</span>
					<span>
						<kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px]">↵</kbd>{" "}
						to select
					</span>
				</div>
			</DialogContent>
		</Dialog>
	);
}

export function useSearchDialog() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		function handleKeyDown(e: KeyboardEvent) {
			if ((e.metaKey || e.ctrlKey) && e.key === "k") {
				e.preventDefault();
				setOpen((prev) => !prev);
			}
		}
		document.addEventListener("keydown", handleKeyDown);
		return () => document.removeEventListener("keydown", handleKeyDown);
	}, []);

	return { open, setOpen };
}
