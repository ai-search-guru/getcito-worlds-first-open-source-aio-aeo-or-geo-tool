'use client'
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useUserBrands } from '@/hooks/useUserBrands';
import { UserBrand } from '@/firebase/firestore/getUserBrands';

interface BrandContextType {
  selectedBrand: UserBrand | null;
  selectedBrandId: string | null;
  brands: UserBrand[];
  setSelectedBrandId: (brandId: string) => void;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  refetchBrands: () => Promise<void>; // Alias for refetch
  clearBrandContext: () => void; // New function to clear context
}

const BrandContext = createContext<BrandContextType>({
  selectedBrand: null,
  selectedBrandId: null,
  brands: [],
  setSelectedBrandId: () => {},
  loading: true,
  error: null,
  refetch: async () => {},
  refetchBrands: async () => {},
  clearBrandContext: () => {},
});

export const useBrandContext = () => {
  const context = useContext(BrandContext);
  if (!context) {
    throw new Error('useBrandContext must be used within a BrandContextProvider');
  }
  return context;
};

interface BrandContextProviderProps {
  children: ReactNode;
}

export function BrandContextProvider({ children }: BrandContextProviderProps): React.ReactElement {
  const { brands, loading, error, refetch } = useUserBrands();
  const [selectedBrandId, setSelectedBrandIdState] = useState<string | null>(null);
  const [isClient, setIsClient] = useState(false);

  // Debug logging for brands data
  useEffect(() => {
    console.log('📊 BrandContext - Brands data updated:', {
      brandsCount: brands.length,
      brands: brands.map(b => ({ id: b.id, name: b.companyName })),
      loading,
      error,
      selectedBrandId,
      isClient
    });
  }, [brands, loading, error, selectedBrandId, isClient]);

  // Mark as client-side to prevent hydration mismatch
  useEffect(() => {
    setIsClient(true);
  }, []);

  // Load selected brand from localStorage on mount
  useEffect(() => {
    if (isClient) {
      const stored = localStorage.getItem('selectedBrandId');
      console.log('💾 Loading from localStorage:', { stored, isClient });
      if (stored) {
        setSelectedBrandIdState(stored);
      }
    }
  }, [isClient]);

  // Auto-select first brand if none selected and brands are available
  useEffect(() => {
    if (brands.length > 0 && !selectedBrandId) {
      const firstBrandId = brands[0].id;
      console.log('🔄 Auto-selecting first brand:', { 
        firstBrandId, 
        brandName: brands[0].companyName,
        brandsCount: brands.length,
        currentSelectedId: selectedBrandId 
      });
      setSelectedBrandIdState(firstBrandId);
      if (isClient) {
        localStorage.setItem('selectedBrandId', firstBrandId);
      }
    }
  }, [brands, selectedBrandId, isClient]);

  // Validate selected brand still exists in user's brands
  useEffect(() => {
    if (selectedBrandId && brands.length > 0) {
      const brandExists = brands.find(brand => brand.id === selectedBrandId);
      if (!brandExists) {
        console.log('⚠️ Selected brand not found, selecting first available:', {
          invalidBrandId: selectedBrandId,
          availableBrands: brands.map(b => ({ id: b.id, name: b.companyName }))
        });
        // Selected brand no longer exists, select first available
        const firstBrandId = brands[0].id;
        setSelectedBrandIdState(firstBrandId);
        if (isClient) {
          localStorage.setItem('selectedBrandId', firstBrandId);
        }
      } else {
        console.log('✅ Brand validation passed:', {
          selectedBrandId,
          brandName: brandExists.companyName
        });
      }
    }
  }, [selectedBrandId, brands, isClient]);

  const setSelectedBrandId = (brandId: string) => {
    console.log('🎯 Setting selected brand:', { 
      newBrandId: brandId, 
      previousBrandId: selectedBrandId,
      brandName: brands.find(b => b.id === brandId)?.companyName 
    });
    setSelectedBrandIdState(brandId);
    if (isClient) {
      localStorage.setItem('selectedBrandId', brandId);
    }
  };

  const clearBrandContext = () => {
    console.log('🧹 Clearing brand context');
    setSelectedBrandIdState(null);
    if (isClient) {
      localStorage.removeItem('selectedBrandId');
    }
  };

  const selectedBrand = selectedBrandId 
    ? brands.find(brand => brand.id === selectedBrandId) || null 
    : null;

  // Prevent hydration mismatch by rendering consistent content initially
  if (!isClient) {
    return (
      <BrandContext.Provider value={{
        selectedBrand: null, // Keep this null to prevent hydration mismatch
        selectedBrandId: null, // Keep this null to prevent hydration mismatch
        brands, // Pass through actual brands data
        setSelectedBrandId: () => {},
        loading, // Pass through actual loading state
        error, // Pass through actual error state
        refetch, // Pass through refetch function
        refetchBrands: refetch, // Alias for refetch
        clearBrandContext: () => {}, // No-op for hydration mismatch
      }}>
        {children}
      </BrandContext.Provider>
    );
  }

  return (
    <BrandContext.Provider value={{
      selectedBrand,
      selectedBrandId,
      brands,
      setSelectedBrandId,
      loading,
              error,
        refetch,
        refetchBrands: refetch, // Alias for refetch
        clearBrandContext,
    }}>
      {children}
    </BrandContext.Provider>
  );
} 