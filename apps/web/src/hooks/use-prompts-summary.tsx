import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getPromptsSummaryFn } from "@/server/prompts";

export type LookbackPeriod = "1w" | "1m" | "3m" | "6m" | "1y" | "all";

export interface PromptsSummaryFilters {
	lookback?: LookbackPeriod;
	webSearchEnabled?: boolean;
	model?: string;
	tags?: string[];
}

export const promptsSummaryKeys = {
	all: ["prompts-summary"] as const,
	list: (brandId: string, filters?: PromptsSummaryFilters) =>
		[...promptsSummaryKeys.all, brandId, filters] as const,
};

export function usePromptsSummary(brandId?: string, filters?: PromptsSummaryFilters) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: promptsSummaryKeys.list(resolvedBrandId || "", filters),
		queryFn: () =>
			getPromptsSummaryFn({
				data: {
					brandId: resolvedBrandId!,
					lookback: filters?.lookback || "1m",
					webSearchEnabled: filters?.webSearchEnabled?.toString(),
					model: filters?.model,
					tags: filters?.tags?.join(","),
				},
			}),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
		refetchInterval: 60_000,
		placeholderData: (prev) => prev, // Keep previous data while refetching
	});

	return {
		promptsSummary: query.data,
		isLoading: query.isLoading,
		isValidating: query.isFetching,
		isError: query.error,
		revalidate: query.refetch,
	};
}

/**
 * Hook to get an invalidation function for prompts summary cache.
 * Call at the top level of a component, then invoke the returned function in handlers.
 */
export function useInvalidatePromptsSummary() {
	const queryClient = useQueryClient();

	return (brandId: string) => {
		queryClient.invalidateQueries({
			queryKey: [...promptsSummaryKeys.all, brandId],
		});
	};
}
