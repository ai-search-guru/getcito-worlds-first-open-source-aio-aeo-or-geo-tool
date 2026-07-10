'use client'
import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getBrandInfo } from '@/firebase/firestore/brandDataService';
import { retrieveDocumentWithLargeData } from '@/firebase/storage/cloudStorage';
import type { UserBrand } from '@/firebase/firestore/getUserBrands';

// Interface for processed query results (the format stored in brand documents)
export interface ProcessedQueryResult {
  id?: string;
  query: string;
  keyword: string;
  category: string;
  date: string;
  processingSessionId: string;
  processingSessionTimestamp: string;
  results: {
    chatgpt?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      webSearchUsed?: boolean;
      citations?: number;
    };
    googleAI?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      totalItems?: number;
      organicResults?: number;
      peopleAlsoAsk?: number;
      location?: string;
      aiOverview?: string;
      aiOverviewReferences?: any[];
      hasAIOverview?: boolean;
      serpFeatures?: any[];
      relatedSearches?: any[];
      videoResults?: any[];
    };
    perplexity?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      citations?: number;
      realTimeData?: boolean;
      citationsData?: string;
      searchResultsData?: string;
      structuredCitationsData?: string;
      citationsCount?: number;
      searchResultsCount?: number;
      structuredCitationsCount?: number;
      hasMetadata?: boolean;
      hasUsageStats?: boolean;
    };
  };
  creditInfo?: {
    creditsDeducted: number;
    creditsAfter: number;
    totalCost: number;
  };
}

interface UseBrandQueriesOptions {
  brandId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseBrandQueriesReturn {
  queries: ProcessedQueryResult[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  stats: {
    total: number;
    withChatGPT: number;
    withGoogleAI: number;
    withPerplexity: number;
    totalSessions: number;
  };
}

export function useBrandQueries(options: UseBrandQueriesOptions = {}): UseBrandQueriesReturn {
  const { user } = useAuthContext();
  const [queries, setQueries] = useState<ProcessedQueryResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  // Fetch queries from brand document
  const fetchQueries = useCallback(async () => {
    if (!user?.uid || !brandId) {
      setQueries([]);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('🔍 Fetching brand queries for brandId:', brandId);
      
      // Get brand info which contains queryProcessingResults
      let brand = await getBrandInfo(brandId);
      
      if (!brand) {
        setError('Brand not found');
        setQueries([]);
        return;
      }

      // If the brand document has storage references, retrieve full data from Cloud Storage
      if ((brand as any).storageReferences?.queryProcessingResults) {
        console.log('📥 Brand has Cloud Storage references, retrieving full query results...');
        try {
          const { document: fullBrandData } = await retrieveDocumentWithLargeData(
            'v8userbrands', 
            brandId, 
            ['queryProcessingResults']
          );
          
          if (fullBrandData?.queryProcessingResults) {
            brand.queryProcessingResults = fullBrandData.queryProcessingResults;
            console.log(`✅ Retrieved ${fullBrandData.queryProcessingResults.length} query results from Cloud Storage`);
          }
        } catch (storageError) {
          console.warn('⚠️ Failed to retrieve query results from Cloud Storage:', storageError);
          // Continue with truncated data from Firestore
        }
      }

      const queryResults = brand.queryProcessingResults || [];
      
      console.log('✅ Brand queries fetched:', {
        brandName: brand.companyName,
        queriesCount: queryResults.length,
        lastProcessed: brand.lastProcessedAt?.toDate?.()?.toISOString() || 'Never'
      });
      
      // Sort by date descending (newest first)
      const sortedQueries = queryResults.slice().sort((a, b) => {
        const dateA = new Date(a.date || 0).getTime();
        const dateB = new Date(b.date || 0).getTime();
        return dateB - dateA;
      });

      setQueries(sortedQueries);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch brand queries';
      setError(errorMessage);
      console.error('Error fetching brand queries:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, brandId]);

  // Initial fetch
  useEffect(() => {
    fetchQueries();
  }, [fetchQueries]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchQueries();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchQueries]);

  // Calculate stats
  const stats = {
    total: queries.length,
    withChatGPT: queries.filter(q => q.results?.chatgpt?.response).length,
    withGoogleAI: queries.filter(q => q.results?.googleAI?.aiOverview).length,
    withPerplexity: queries.filter(q => q.results?.perplexity?.response).length,
    totalSessions: new Set(queries.map(q => q.processingSessionId)).size,
  };

  return {
    queries,
    loading,
    error,
    refetch: fetchQueries,
    stats,
  };
} 