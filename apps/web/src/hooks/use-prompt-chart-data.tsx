import { useQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { getPromptChartDataFn } from "@/server/prompts";

export type LookbackPeriod = "1w" | "1m" | "3m" | "6m" | "1y" | "all";

export interface PromptChartDataFilters {
	lookback?: LookbackPeriod;
	webSearchEnabled?: boolean;
	model?: string;
}

export interface PromptChartDataResponse {
	prompt: {
		id: string;
		value: string;
	};
	chartData: Array<{
		date: string;
		[key: string]: number | string | null;
	}>;
	brand: any;
	competitors: any[];
	totalRuns: number;
	hasVisibilityData: boolean;
	lastBrandVisibility: number | null;
	webQueryMapping: Record<string, string>;
	modelWebQueryMappings: Record<string, Record<string, string>>;
}

export function usePromptChartData(
	brandId: string | undefined,
	promptId: string,
	filters?: PromptChartDataFilters,
	enabled: boolean = true,
) {
	const params = useParams({ strict: false });
	const resolvedBrandId =
		brandId || (params && "brand" in params ? (params.brand as string) : undefined);

	const { data, error, isLoading, refetch } = useQuery({
		queryKey: ["promptChartData", resolvedBrandId, promptId, filters],
		queryFn: () =>
			getPromptChartDataFn({
				data: {
					brandId: resolvedBrandId!,
					promptId,
					lookback: filters?.lookback || "1m",
					webSearchEnabled: filters?.webSearchEnabled?.toString(),
					model: filters?.model,
					timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
				},
			}),
		enabled: enabled && !!resolvedBrandId,
		staleTime: 60_000,
		retry: 3,
		placeholderData: (prev) => prev, // Keep previous data while refetching with new filters
	});

	return {
		chartData: data as PromptChartDataResponse | undefined,
		isLoading,
		isError: error,
		revalidate: refetch,
	};
}
