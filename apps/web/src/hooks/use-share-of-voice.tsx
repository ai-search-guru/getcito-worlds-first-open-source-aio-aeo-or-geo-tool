import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getShareOfVoiceFn } from "@/server/analysis";
import type { LookbackPeriod } from "@/lib/chart-utils";

export interface ShareOfVoiceFilters {
	lookback?: LookbackPeriod;
	model?: string;
	/** Tag filter (resolved to prompt IDs server-side, like the visibility page). */
	tags?: string[];
}

export const shareOfVoiceKeys = {
	all: ["share-of-voice"] as const,
	list: (brandId: string, filters?: ShareOfVoiceFilters) => [...shareOfVoiceKeys.all, brandId, filters] as const,
};

export function useShareOfVoice(brandId?: string, filters?: ShareOfVoiceFilters) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: shareOfVoiceKeys.list(resolvedBrandId || "", filters),
		queryFn: () =>
			getShareOfVoiceFn({
				data: {
					brandId: resolvedBrandId!,
					lookback: filters?.lookback ?? "1m",
					model: filters?.model,
					tags: filters?.tags?.join(","),
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			}),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		placeholderData: (prev) => prev,
	});

	return {
		data: query.data,
		isLoading: query.isLoading,
		isFetching: query.isFetching,
		isError: !!query.error,
		revalidate: query.refetch,
	};
}
