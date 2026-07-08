import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Input } from "@workspace/ui/components/input";
import { Badge } from "@workspace/ui/components/badge";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconExternalLink, IconInfoCircle, IconSearch } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import {
	UnderlineTabs,
	formatUrlForDisplay,
	extractFilenameFromUrl,
	getCategoryLabel,
	getCategoryColorClass,
} from "@/components/citations/shared";
import type { CitationData } from "@/components/citations/types";

export function TopUrlsCard({
	urls,
	sourceTabs,
	pageTypeTabs,
	maxUrls,
	brandId,
	brandName,
	brandShare,
	brandIsCited,
}: {
	urls: CitationData["specificUrls"];
	sourceTabs: { key: string; label: string }[];
	pageTypeTabs: { key: string; label: string }[];
	maxUrls: number;
	brandId?: string;
	brandName?: string;
	brandShare: number;
	brandIsCited: boolean;
}) {
	const [urlSearch, setUrlSearch] = useState("");
	const [selectedCategory, setSelectedCategory] = useState<string>("all");
	const [selectedPageType, setSelectedPageType] = useState<string>("all");

	const filteredUrls = useMemo(() => {
		let result = urls;
		if (selectedCategory !== "all") {
			result = result.filter((u) => u.category === selectedCategory);
		}
		if (selectedPageType !== "all") {
			result = result.filter((u) => u.pageType === selectedPageType);
		}
		if (urlSearch) {
			const q = urlSearch.toLowerCase();
			result = result.filter((u) =>
				u.url.toLowerCase().includes(q) ||
				(u.title?.toLowerCase().includes(q)) ||
				u.domain.toLowerCase().includes(q)
			);
		}
		return result.slice(0, maxUrls);
	}, [urls, selectedCategory, selectedPageType, urlSearch, maxUrls]);

	return (
		<Card className="gap-4">
			<CardHeader>
				<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
					<div className="space-y-1 min-w-0">
						<CardTitle className="flex items-center gap-1.5">
							Top Cited URLs
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-sm font-normal">
									<p className="mb-2">The specific pages most frequently cited by AI models. Filter by category to focus on brand, competitor, or other sources.</p>
									<p><strong>Competitor</strong> domains are only those in your {brandId ? <Link to="/app/$brand/settings/competitors" params={{ brand: brandId }} className="underline">tracked competitors list</Link> : "tracked competitors list"}.</p>
								</TooltipContent>
							</Tooltip>
						</CardTitle>
						<CardDescription>
							Individual pages cited by LLMs{brandIsCited && brandName && (
								<> &mdash; {brandName} accounts for <strong>{brandShare}%</strong> of all citations</>
							)}
						</CardDescription>
					</div>
					<div className="relative w-full sm:w-48 shrink-0">
						<IconSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
						<Input
							placeholder="Search URLs..."
							value={urlSearch}
							onChange={(e) => setUrlSearch(e.target.value)}
							className="h-8 pl-8 text-xs"
						/>
					</div>
				</div>
			</CardHeader>
			<Separator />
			<CardContent>
				{sourceTabs.length > 2 && (
					<UnderlineTabs
						tabs={sourceTabs}
						activeKey={selectedCategory}
						onSelect={setSelectedCategory}
					/>
				)}
				{pageTypeTabs.length > 2 && (
					<div className="flex items-center flex-wrap gap-1.5 mt-3">
						{pageTypeTabs.map((t) => (
							<button
								key={t.key}
								type="button"
								onClick={() => setSelectedPageType(t.key)}
								className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${selectedPageType === t.key ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground hover:bg-muted/60"}`}
							>
								{t.label}
							</button>
						))}
					</div>
				)}
				<div className="divide-y divide-border mt-1">
					{filteredUrls.map((citation) => {
						const displayUrl = formatUrlForDisplay(citation.url);
						const domainEndIndex = displayUrl.indexOf("/");
						const domainPart = domainEndIndex > 0 ? displayUrl.substring(0, domainEndIndex) : displayUrl;
						const pathPart = domainEndIndex > 0 ? displayUrl.substring(domainEndIndex) : "";

						return (
							<a
								key={citation.url}
								href={citation.url}
								target="_blank"
								rel="noopener noreferrer"
								className="flex items-start justify-between gap-3 py-3 group"
							>
								<div className="min-w-0 flex-1">
									<div className="flex items-center gap-2 mb-0.5">
										<Badge className={`text-[10px] px-1.5 py-0 h-[18px] border-0 shadow-none ${getCategoryColorClass(citation.category)}`}>
											{getCategoryLabel(citation.category)}
										</Badge>
										{citation.isNew && (
											<Badge className="text-[10px] px-1.5 py-0 h-[18px] border-0 shadow-none bg-green-100 text-green-700">NEW</Badge>
										)}
										<span className="text-sm font-medium truncate group-hover:underline">
											{citation.title || extractFilenameFromUrl(citation.url)}
										</span>
									</div>
									<div className="text-xs text-muted-foreground truncate">
										<span className="font-semibold">{domainPart}</span>
										{pathPart && <span>{pathPart}</span>}
									</div>
								</div>
								<div className="flex items-center gap-3 shrink-0 pt-0.5">
									{citation.avgPosition != null && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="text-[11px] text-muted-foreground tabular-nums">avg {citation.avgPosition.toFixed(1)}</span>
											</TooltipTrigger>
											<TooltipContent className="text-xs">
												Average citation position (lower = cited earlier in the response)
											</TooltipContent>
										</Tooltip>
									)}
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="text-sm font-semibold tabular-nums min-w-[2rem] text-right">
												{citation.count.toLocaleString()}
											</span>
										</TooltipTrigger>
										<TooltipContent className="text-xs">
											Total times this URL was cited across all prompt evaluations
										</TooltipContent>
									</Tooltip>
									<IconExternalLink className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
								</div>
							</a>
						);
					})}
					{filteredUrls.length === 0 && (
						<p className="text-sm text-muted-foreground text-center pt-8 pb-4">
							No URLs match the current filters.
						</p>
					)}
				</div>
			</CardContent>
		</Card>
	);
}
