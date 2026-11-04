import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Brand } from '@/types';

interface BrandStore {
  brands: Brand[];
  activeBrandId: string | null;
  /**
   * The brands are the server's list (setBrands), not yet the last visit's
   * or none: until then an empty list doesn't mean the member has no brand,
   * and the brand on screen (the demo brand or the workspace's own) isn't
   * known. Never kept between visits.
   */
  loaded: boolean;
  setBrands: (brands: Brand[]) => void;
  addBrand: (brand: Brand) => void;
  updateBrand: (id: string, updates: Partial<Brand>) => void;
  removeBrand: (id: string) => void;
  setActiveBrand: (id: string) => void;
  getActiveBrand: () => Brand | null;
}

export const useBrandStore = create<BrandStore>()(
  persist(
    (set, get) => ({
      brands: [],
      activeBrandId: null,
      loaded: false,

      // The brand kept from the last visit only while it is still one of the
      // member's: a brand deleted, or another workspace's (an account
      // switched in this browser), sent with every call answers 404 or 403
      // (BUG-001).
      setBrands: (brands) =>
        set({
          brands,
          loaded: true,
          activeBrandId: brands.some((b) => b.id === get().activeBrandId)
            ? get().activeBrandId
            : (brands[0]?.id ?? null),
        }),

      addBrand: (brand) =>
        set((state) => ({
          brands: [...state.brands, brand],
          activeBrandId: state.activeBrandId ?? brand.id,
        })),

      updateBrand: (id, updates) =>
        set((state) => ({
          brands: state.brands.map((b) => (b.id === id ? { ...b, ...updates } : b)),
        })),

      removeBrand: (id) =>
        set((state) => {
          const remaining = state.brands.filter((b) => b.id !== id);
          return {
            brands: remaining,
            activeBrandId:
              state.activeBrandId === id ? (remaining[0]?.id ?? null) : state.activeBrandId,
          };
        }),

      setActiveBrand: (id) => set({ activeBrandId: id }),

      getActiveBrand: () => {
        const { brands, activeBrandId } = get();
        return brands.find((b) => b.id === activeBrandId) ?? null;
      },
    }),
    {
      name: 'brand-store',
      partialize: (state) => ({
        activeBrandId: state.activeBrandId,
        brands: state.brands,
      }),
    },
  ),
);
