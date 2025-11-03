'use client'
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { 
  getLatestBrandAnalytics, 
  getBrandAnalyticsHistory, 
  getUserBrandAnalytics,
  calculateLifetimeBrandAnalytics,
  calculateLatestSessionFromBrandDocument,
  saveLifetimeAnalytics,
  type BrandAnalyticsData, 
  type BrandAnalyticsHistory,
  type LifetimeBrandAnalytics
} from '@/firebase/firestore/brandAnalytics';

// Hook for getting latest brand analytics (session-based) - optimized with React Query
export function useLatestBrandAnalytics(brandId: string | undefined) {
  return useQuery({
    queryKey: ['latestBrandAnalytics', brandId],
    queryFn: async () => {
      if (!brandId) return null;

      // Use the same data source as lifetime analytics for consistency and speed
      const { result: lifetimeResult, error: lifetimeError } = await calculateLifetimeBrandAnalytics(brandId);
      
      if (lifetimeError) {
        throw new Error('Failed to fetch analytics');
      }

      if (!lifetimeResult) {
        return null;
      }

      // Extract latest session data from the lifetime calculation
      const { result: latestSessionAnalytics } = await calculateLatestSessionFromBrandDocument(brandId);
      
      if (latestSessionAnalytics) {
        // Save the calculated analytics to Firestore for persistence (fire and forget)
        try {
          const { saveBrandAnalytics } = await import('@/firebase/firestore/brandAnalytics');
          saveBrandAnalytics(latestSessionAnalytics).catch(console.warn);
        } catch {
          // Ignore save errors, we have the data
        }
        
        return latestSessionAnalytics;
      } else {
        // Fallback: convert lifetime to session format if no distinct session found
        const sessionAnalytics: BrandAnalyticsData = {
          id: undefined,
          userId: lifetimeResult.userId,
          brandId: lifetimeResult.brandId,
          brandName: lifetimeResult.brandName,
          brandDomain: lifetimeResult.brandDomain,
          processingSessionId: 'latest_session',
          processingSessionTimestamp: new Date().toISOString(),
          totalQueriesProcessed: lifetimeResult.totalQueriesProcessed,
          totalBrandMentions: lifetimeResult.totalBrandMentions,
          brandVisibilityScore: lifetimeResult.brandVisibilityScore,
          totalCitations: lifetimeResult.totalCitations,
          totalDomainCitations: lifetimeResult.totalDomainCitations,
          providerStats: lifetimeResult.providerStats,
          insights: {
            ...lifetimeResult.insights,
            brandVisibilityTrend: 'stable' as const,
            competitorMentionsDetected: 0
          },
          lastUpdated: lifetimeResult.calculatedAt,
          createdAt: lifetimeResult.calculatedAt
        };
        return sessionAnalytics;
      }
    },
    enabled: !!brandId,
    staleTime: 3 * 60 * 1000, // Consider data fresh for 3 minutes
    gcTime: 5 * 60 * 1000, // Keep in cache for 5 minutes
    refetchOnWindowFocus: false,
  });
}

// Hook for getting lifetime brand analytics (all historical data) - optimized with React Query
export function useLifetimeBrandAnalytics(brandId: string | undefined) {
  return useQuery({
    queryKey: ['lifetimeBrandAnalytics', brandId],
    queryFn: async () => {
      if (!brandId) return null;

      const { result, error: fetchError } = await calculateLifetimeBrandAnalytics(brandId);
      
      if (fetchError) {
        throw new Error('Failed to calculate lifetime analytics');
      }

      if (result) {
        // Only save analytics periodically to avoid write stream exhaustion
        // Check if we need to save (save every 5 minutes max)
        const now = Date.now();
        const lastSave = localStorage.getItem(`lastAnalyticsSave_${brandId}`);
        const shouldSave = !lastSave || (now - parseInt(lastSave)) > 5 * 60 * 1000; // 5 minutes
        
        if (shouldSave) {
          // Save the calculated lifetime analytics to Firestore for persistence (fire and forget)
          try {
            const { saveLifetimeAnalytics } = await import('@/firebase/firestore/brandAnalytics');
            saveLifetimeAnalytics(result).then(() => {
              localStorage.setItem(`lastAnalyticsSave_${brandId}`, now.toString());
            }).catch(error => {
              console.warn('⚠️ Failed to save lifetime analytics:', error);
            });
          } catch {
            // Ignore save errors, we have the data
          }
        } else {
          console.log('⏭️ Skipping analytics save (last saved recently)');
        }
      }
      
      return result || null;
    },
    enabled: !!brandId,
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes (lifetime data changes less frequently)
    gcTime: 10 * 60 * 1000, // Keep in cache for 10 minutes
    refetchOnWindowFocus: false,
  });
}

// Combined hook for getting both latest and lifetime analytics - optimized with React Query
export function useBrandAnalyticsCombined(brandId: string | undefined) {
  const latestQuery = useLatestBrandAnalytics(brandId);
  const lifetimeQuery = useLifetimeBrandAnalytics(brandId);

  const loading = latestQuery.isLoading || lifetimeQuery.isLoading;
  const error = latestQuery.error?.message || lifetimeQuery.error?.message || null;

  return {
    latestAnalytics: latestQuery.data || null,
    lifetimeAnalytics: lifetimeQuery.data || null,
    loading,
    error,
    hasLatestData: !!latestQuery.data,
    hasLifetimeData: !!lifetimeQuery.data,
    // Expose refetch functions for manual refresh
    refetchLatest: latestQuery.refetch,
    refetchLifetime: lifetimeQuery.refetch,
    // Expose individual query states for more granular control
    latestQuery,
    lifetimeQuery
  };
}

// Hook for getting brand analytics history with trend analysis
export function useBrandAnalyticsHistory(brandId: string | undefined) {
  const [history, setHistory] = useState<BrandAnalyticsHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchHistory() {
      if (!brandId) {
        setHistory(null);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const { result, error: fetchError } = await getBrandAnalyticsHistory(brandId);
        
        if (fetchError) {
          setError('Failed to fetch analytics history');
          console.error('Analytics history error:', fetchError);
        } else {
          setHistory(result || null);
        }
      } catch (err) {
        setError('Failed to fetch analytics history');
        console.error('Analytics history error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchHistory();
  }, [brandId]);

  return { history, loading, error };
}

// Hook for getting all user brand analytics
export function useUserBrandAnalytics(userId: string | undefined) {
  const [userAnalytics, setUserAnalytics] = useState<BrandAnalyticsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchUserAnalytics() {
      if (!userId) {
        setUserAnalytics([]);
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const { result, error: fetchError } = await getUserBrandAnalytics(userId);
        
        if (fetchError) {
          setError('Failed to fetch user analytics');
          console.error('User analytics error:', fetchError);
        } else {
          setUserAnalytics(result || []);
        }
      } catch (err) {
        setError('Failed to fetch user analytics');
        console.error('User analytics error:', err);
      } finally {
        setLoading(false);
      }
    }

    fetchUserAnalytics();
  }, [userId]);

  return { userAnalytics, loading, error };
}

// Hook for aggregated user analytics summary
export function useUserAnalyticsSummary(userId: string | undefined) {
  const { userAnalytics, loading, error } = useUserBrandAnalytics(userId);

  const summary = {
    totalBrands: userAnalytics.length,
    totalBrandMentions: userAnalytics.reduce((sum, analytics) => sum + analytics.totalBrandMentions, 0),
    totalCitations: userAnalytics.reduce((sum, analytics) => sum + analytics.totalCitations, 0),
    averageVisibilityScore: userAnalytics.length > 0 
      ? userAnalytics.reduce((sum, analytics) => sum + analytics.brandVisibilityScore, 0) / userAnalytics.length
      : 0,
    topPerformingBrand: userAnalytics.length > 0
      ? userAnalytics.reduce((prev, current) => 
          prev.totalBrandMentions > current.totalBrandMentions ? prev : current
        ).brandName
      : null
  };

  return { summary, loading, error };
} 