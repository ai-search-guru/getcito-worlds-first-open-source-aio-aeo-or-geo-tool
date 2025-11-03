'use client'
import { useMemo } from 'react';
import { useLifetimeCitations } from '@/hooks/useLifetimeCitations';

interface UseTotalCitationsOptions {
  brandId?: string;
}

interface UseTotalCitationsReturn {
  totalCitations: number;
  loading: boolean;
  error: string | null;
}

/**
 * Hook to get the total count of citations with valid domains
 * This matches the logic used in the citations page: allCitations.filter(c => c.domain).length
 */
export function useTotalCitations(options: UseTotalCitationsOptions = {}): UseTotalCitationsReturn {
  const { brandId } = options;
  
  const { 
    citations, 
    loading, 
    error 
  } = useLifetimeCitations({ 
    brandId 
  });

  const totalCitations = useMemo(() => {
    // Filter citations that have a valid domain (same logic as citations page)
    return citations.filter(c => c.domain).length;
  }, [citations]);

  return {
    totalCitations,
    loading,
    error
  };
}