/**
 * Mock for @/server/brands used in Storybook stories. Provides stubs for
 * every server function exported by the real module so the route tree can
 * be bundled, plus knobs that BrandOnboarding stories use to drive delays
 * and errors against `createBrandFn`.
 */
let _delayMs = 0;
let _shouldThrow: string | null = null;

export function setMockCreateBrandDelay(ms: number) {
	_delayMs = ms;
}

export function setMockCreateBrandError(message: string | null) {
	_shouldThrow = message;
}

export const getBrands = async () => [];

export const getBrand = async (_args: { data: unknown }) => null;

export const createBrandFn = async (_args: { data: unknown }) => {
	if (_delayMs > 0) await new Promise((r) => setTimeout(r, _delayMs));
	if (_shouldThrow) throw new Error(_shouldThrow);
	return { id: "mock-brand-id", success: true };
};

export const updateBrandFn = async (_args: { data: unknown }) => ({ success: true });

export const getCompetitors = async (_args: { data: unknown }) => [];

export const updateCompetitors = async (_args: { data: unknown }) => ({ success: true });

export const addDomainToBrandFn = async (_args: { data: unknown }) => ({ success: true });

export const addDomainToCompetitorFn = async (_args: { data: unknown }) => ({ success: true });

export const createCompetitorFromDomainFn = async (_args: { data: unknown }) => ({ success: true });
