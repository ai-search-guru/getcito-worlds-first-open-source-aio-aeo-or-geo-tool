import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import type { BrandWithPrompts, Competitor } from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers/types";
import { getBrands, getBrand, getCompetitors } from "@/server/brands";

export type BrandWithPromptsAndDataInfo = BrandWithPrompts & {
	earliestDataDate?: string | null;
	/** Deployment-configured model ids this brand actually runs, after
	 *  `brand.enabledModels` is applied. Comes from the server so the UI
	 *  doesn't have to hardcode a model list. */
	effectiveModels: string[];
	/** Same as `effectiveModels` but with provider / version / webSearch
	 *  metadata, for pages that render per-model details. */
	effectiveModelConfigs: ModelConfig[];
};

// ============================================================================
// Query keys
// ============================================================================

export const brandKeys = {
	all: ["brands"] as const,
	list: () => [...brandKeys.all, "list"] as const,
	detail: (brandId: string) => [...brandKeys.all, "detail", brandId] as const,
	competitors: (brandId: string) => [...brandKeys.all, "competitors", brandId] as const,
};

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get all brands the user has access to
 */
export function useBrands() {
	const query = useQuery({
		queryKey: brandKeys.list(),
		queryFn: () => getBrands(),
		staleTime: 30_000, // 30 seconds
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	});

	return {
		brands: query.data,
		isLoading: query.isLoading,
		isError: query.error,
		revalidate: query.refetch,
	};
}

/**
 * Get a single brand by ID.
 * If no brandId provided, extracts from route params.
 */
export function useBrand(brandId?: string) {
	// Try to get brandId from route params if not provided
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;
	const queryClient = useQueryClient();

	const query = useQuery({
		queryKey: brandKeys.detail(resolvedBrandId || ""),
		queryFn: () => getBrand({ data: { brandId: resolvedBrandId! } }),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	});

	const revalidate = async () => {
		await query.refetch();
		// Also invalidate the brands list
		queryClient.invalidateQueries({ queryKey: brandKeys.list() });
	};

	return {
		brandId: resolvedBrandId,
		brand: query.data as BrandWithPromptsAndDataInfo | undefined,
		isLoading: query.isLoading,
		isError: query.error,
		revalidate,
	};
}

/**
 * Get competitors for a brand
 */
export function useCompetitors(brandId?: string) {
	const params = useParams({ strict: false }) as { brand?: string };
	const resolvedBrandId = brandId || params.brand;

	const query = useQuery({
		queryKey: brandKeys.competitors(resolvedBrandId || ""),
		queryFn: () => getCompetitors({ data: { brandId: resolvedBrandId! } }),
		enabled: !!resolvedBrandId,
		staleTime: 30_000,
		refetchOnWindowFocus: true,
		refetchOnReconnect: true,
	});

	return {
		competitors: query.data || [],
		isLoading: query.isLoading,
		isError: query.error,
		revalidate: query.refetch,
	};
}

/**
 * Utility for invalidating all brand-related queries
 */
export function useBrandsRevalidation() {
	const queryClient = useQueryClient();

	const revalidateAll = () => {
		queryClient.invalidateQueries({ queryKey: brandKeys.all });
	};

	return { revalidateAll };
}
