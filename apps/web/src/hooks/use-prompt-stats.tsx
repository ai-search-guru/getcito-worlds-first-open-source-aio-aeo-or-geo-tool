import { useQuery } from "@tanstack/react-query";
import { getPromptStatsFn } from "@/server/prompts";

export const promptStatsKeys = {
	all: ["prompt-stats"] as const,
	detail: (promptId: string, days: number) =>
		[...promptStatsKeys.all, promptId, days] as const,
};

export function usePromptStats(promptId?: string, options?: { days?: number }) {
	const days = options?.days || 7;

	const query = useQuery({
		queryKey: promptStatsKeys.detail(promptId || "", days),
		queryFn: () => getPromptStatsFn({ data: { promptId: promptId!, days } }),
		enabled: !!promptId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		placeholderData: (prev) => prev, // Keep previous data while refetching
	});

	return {
		data: query.data,
		promptStats: query.data,
		isLoading: query.isLoading,
		isError: query.error,
		revalidate: query.refetch,
		// Convenience accessors (match Next.js hook)
		prompt: query.data?.prompt,
		aggregations: query.data?.aggregations,
	};
}
