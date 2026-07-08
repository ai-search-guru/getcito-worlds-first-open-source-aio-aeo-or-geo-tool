import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getOpportunitiesFn } from "@/server/opportunities";

export const opportunitiesKeys = {
	all: ["opportunities-report"] as const,
	detail: (brandId: string) => [...opportunitiesKeys.all, brandId] as const,
};

/**
 * Opportunities AEO report. The server returns a stored report and regenerates it
 * only when the latest is stale, so this is held for the session (staleTime:
 * Infinity, no refetch-on-focus) rather than refetched.
 */
export function useOpportunities(brandId?: string) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: opportunitiesKeys.detail(resolvedBrandId || ""),
		queryFn: () =>
			getOpportunitiesFn({
				data: { brandId: resolvedBrandId!, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone },
			}),
		enabled: !!resolvedBrandId,
		staleTime: Number.POSITIVE_INFINITY,
		refetchOnWindowFocus: false,
		retry: false,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		isError: !!query.error,
		revalidate: query.refetch,
	};
}
