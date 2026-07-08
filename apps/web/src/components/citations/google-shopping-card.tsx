import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Separator } from "@workspace/ui/components/separator";
import { Tooltip, TooltipTrigger, TooltipContent } from "@workspace/ui/components/tooltip";
import { IconInfoCircle, IconSearch, IconChevronDown } from "@tabler/icons-react";
import { Link } from "@tanstack/react-router";
import { ListPagination, usePagedList } from "@/components/list-pagination";
import { attributionDotClass } from "@/components/citations/shared";
import type { GoogleModuleData } from "@/components/citations/types";

const PRODUCTS_PAGE_SIZE = 10;

function PromptCountList({
	prompts,
	brandId,
}: {
	prompts: { id: string; value: string; count: number }[];
	brandId?: string;
}) {
	return (
		<div className="pl-5 pb-2 space-y-0.5">
			{prompts.map((p) => (
				brandId ? (
					<Link key={p.id} to="/app/$brand/prompts/$promptId" params={{ brand: brandId, promptId: p.id }} className="flex items-center justify-between py-1 group text-xs">
						<span className="text-muted-foreground group-hover:text-foreground group-hover:underline truncate min-w-0">{p.value}</span>
						<span className="tabular-nums text-muted-foreground shrink-0 ml-3">{p.count.toLocaleString()}</span>
					</Link>
				) : (
					<div key={p.id} className="flex items-center justify-between py-1 text-xs">
						<span className="text-muted-foreground truncate min-w-0">{p.value}</span>
						<span className="tabular-nums text-muted-foreground shrink-0 ml-3">{p.count.toLocaleString()}</span>
					</div>
				)
			))}
		</div>
	);
}

export function GoogleShoppingCard({
	googleModule,
	brandId,
}: {
	googleModule: GoogleModuleData;
	brandId?: string;
}) {
	const [expandedProduct, setExpandedProduct] = useState<string | null>(null);
	const [productFilter, setProductFilter] = useState<"all" | "brand" | "competitor">("all");
	const [expandedQuery, setExpandedQuery] = useState<string | null>(null);
	const [showAllQueries, setShowAllQueries] = useState(false);

	const filteredProducts = useMemo(() => {
		const ps = googleModule.shopping.products;
		return productFilter === "all" ? ps : ps.filter((p) => p.attribution === productFilter);
	}, [googleModule, productFilter]);
	const productCounts = useMemo(() => {
		const ps = googleModule.shopping.products;
		return {
			all: ps.length,
			brand: ps.filter((p) => p.attribution === "brand").length,
			competitor: ps.filter((p) => p.attribution === "competitor").length,
		};
	}, [googleModule]);

	const { page, setPage, pageItems, totalItems } = usePagedList(filteredProducts, PRODUCTS_PAGE_SIZE);

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-1.5">
					Google Shopping
					<Tooltip>
						<TooltipTrigger asChild>
							<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
						</TooltipTrigger>
						<TooltipContent className="max-w-xs text-sm font-normal">
							Product cards Google AI Mode showed when answering your prompts. The number next to each is how many times that card appeared across results (card inclusions, not unique products). Kept separate from the citation mix above.
						</TooltipContent>
					</Tooltip>
				</CardTitle>
				<CardDescription>
					Products Google AI Mode surfaced — <span className="font-medium text-emerald-600">{googleModule.shopping.brandCount.toLocaleString()}</span> appearances for yours vs <span className="font-medium text-red-600">{googleModule.shopping.competitorCount.toLocaleString()}</span> for competitors
				</CardDescription>
			</CardHeader>
			<Separator />
			<CardContent className="space-y-6">
				{googleModule.shopping.products.length > 0 && (
					<div>
						<div className="flex items-center justify-between mb-2 gap-2">
							<h4 className="text-sm font-medium shrink-0">Products</h4>
							<div className="flex items-center gap-1">
								{([["all", "All"], ["brand", "Yours"], ["competitor", "Competitors"]] as const).map(([key, label]) => (
									<button
										key={key}
										type="button"
										onClick={() => { setProductFilter(key); setPage(0); }}
										className={`px-2 py-0.5 rounded text-[11px] cursor-pointer transition-colors ${productFilter === key ? "bg-muted text-foreground font-medium" : "text-muted-foreground hover:text-foreground"}`}
									>
										{label} ({productCounts[key].toLocaleString()})
									</button>
								))}
							</div>
						</div>
						<div className="divide-y divide-border/50">
							{pageItems.map((product) => {
								const isExpanded = expandedProduct === product.name;
								return (
									<div key={product.name}>
										<div className="flex items-center justify-between py-2 gap-3">
											<button
												type="button"
												onClick={() => setExpandedProduct(isExpanded ? null : product.name)}
												className="flex items-center gap-1.5 min-w-0 cursor-pointer group text-left"
											>
												<IconChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
												<span className={`shrink-0 rounded-full h-2 w-2 ${attributionDotClass(product.attribution)}`} />
												<span className="text-sm font-medium text-foreground group-hover:underline truncate">{product.name}</span>
												{product.attribution === "competitor" && product.competitorName && (
													<span className="text-[10px] text-muted-foreground whitespace-nowrap shrink-0">({product.competitorName})</span>
												)}
											</button>
											<span className="text-sm font-semibold tabular-nums shrink-0">{product.count.toLocaleString()}</span>
										</div>
										{isExpanded && product.prompts.length > 0 && (
											<PromptCountList prompts={product.prompts} brandId={brandId} />
										)}
									</div>
								);
							})}
						</div>
						<ListPagination page={page} pageSize={PRODUCTS_PAGE_SIZE} totalItems={totalItems} onPageChange={setPage} />
					</div>
				)}

				{googleModule.search.queries.length > 0 && (
					<div>
						<h4 className="text-sm font-medium mb-2">Search queries</h4>
						<div className="divide-y divide-border/50">
							{(showAllQueries ? googleModule.search.queries : googleModule.search.queries.slice(0, 5)).map((q) => {
								const isExpanded = expandedQuery === q.query;
								return (
									<div key={q.query}>
										<div className="flex items-center justify-between py-2 gap-3">
											<button
												type="button"
												onClick={() => setExpandedQuery(isExpanded ? null : q.query)}
												className="flex items-center gap-1.5 min-w-0 cursor-pointer group text-left"
											>
												<IconChevronDown className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
												<IconSearch className="h-3 w-3 shrink-0 text-muted-foreground" />
												<span className="text-sm font-medium text-foreground group-hover:underline truncate">{q.query}</span>
											</button>
											<span className="text-sm font-semibold tabular-nums shrink-0">{q.count.toLocaleString()}</span>
										</div>
										{isExpanded && q.prompts.length > 0 && (
											<PromptCountList prompts={q.prompts} brandId={brandId} />
										)}
									</div>
								);
							})}
						</div>
						{googleModule.search.queries.length > 5 && !showAllQueries && (
							<button
								type="button"
								onClick={() => setShowAllQueries(true)}
								className="mt-3 text-xs text-muted-foreground hover:text-foreground cursor-pointer px-3 py-1.5 rounded-md border border-border hover:bg-muted/60 transition-colors"
							>
								Show {googleModule.search.queries.length - 5} more
							</button>
						)}
					</div>
				)}
			</CardContent>
		</Card>
	);
}
