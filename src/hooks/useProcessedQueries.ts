'use client'
import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getQueriesByUser, getQueriesByBrand } from '@/firebase/firestore/userQueries';
import type { UserQueryDocument } from '@/firebase/firestore/userQueries';

interface UseProcessedQueriesOptions {
  brandId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseProcessedQueriesReturn {
  queries: UserQueryDocument[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  processQueries: (brandId?: string) => Promise<void>;
  stats: {
    total: number;
    completed: number;
    processing: number;
    errors: number;
  };
}

export function useProcessedQueries(options: UseProcessedQueriesOptions = {}): UseProcessedQueriesReturn {
  const { user } = useAuthContext();
  const [queries, setQueries] = useState<UserQueryDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  // Fetch queries
  const fetchQueries = useCallback(async () => {
    if (!user?.uid) {
      setQueries([]);
      setLoading(false);
      return;
    }

    try {
      setError(null);
      
      let result;
      if (brandId) {
        const response = await getQueriesByBrand(brandId);
        result = response.result;
        error && setError(response.error);
      } else {
        const response = await getQueriesByUser(user.uid);
        result = response.result;
        error && setError(response.error);
      }

      setQueries(result || []);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch queries';
      setError(errorMessage);
      console.error('Error fetching queries:', err);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, brandId]);

  // Process new queries
  const processQueries = useCallback(async (specificBrandId?: string) => {
    if (!user?.uid) {
      setError('User not authenticated');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const response = await fetch('/api/process-user-queries', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.uid,
          brandId: specificBrandId || brandId,
          processAll: !specificBrandId && !brandId
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to process queries');
      }

      // Refresh queries after processing
      await fetchQueries();

      console.log('✅ Queries processed:', data.summary);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process queries';
      setError(errorMessage);
      console.error('Error processing queries:', err);
    } finally {
      setProcessing(false);
    }
  }, [user?.uid, brandId, fetchQueries]);

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
    completed: queries.filter(q => q.status === 'completed').length,
    processing: queries.filter(q => q.status === 'processing').length,
    errors: queries.filter(q => q.status === 'error').length,
  };

  return {
    queries,
    loading: loading || processing,
    error,
    refetch: fetchQueries,
    processQueries,
    stats,
  };
} 