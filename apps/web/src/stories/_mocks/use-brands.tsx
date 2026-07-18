/**
 * Mock for @/hooks/use-brands — provides controllable brand data for stories.
 */

// Module-level state that stories can set before rendering
let _mockBrand: any = null;
let _mockBrands: any[] = [];
let _mockCompetitors: any[] = [];

export function setMockBrand(brand: any) {
	_mockBrand = brand;
}

export function setMockBrands(brands: any[]) {
	_mockBrands = brands;
}

export function setMockCompetitors(competitors: any[]) {
	_mockCompetitors = competitors;
}

// Re-export types used by consumers
export type BrandWithPromptsAndDataInfo = any;

export const brandKeys = {
	all: ["brands"] as const,
	list: () => ["brands", "list"] as const,
	detail: (brandId: string) => ["brands", "detail", brandId] as const,
	competitors: (brandId: string) => ["brands", "competitors", brandId] as const,
};

export function useBrands() {
	return {
		brands: _mockBrands,
		isLoading: false,
		isError: null,
		revalidate: async () => {},
	};
}

export function useBrand(_brandId?: string) {
	return {
		brandId: _mockBrand?.id || "mock-brand-id",
		brand: _mockBrand,
		isLoading: false,
		isError: null,
		revalidate: async () => {},
	};
}

export function useCompetitors(_brandId?: string) {
	return {
		competitors: _mockCompetitors,
		isLoading: false,
		isError: null,
		revalidate: async () => {},
	};
}

export function useBrandsRevalidation() {
	return { revalidateAll: () => {} };
}
