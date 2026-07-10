import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import {
  getUserMetrics,
  getLeaderboardData,
  getUserRecommendations,
  getUserTopDomains,
  getUserTrendData,
  getBrandPromptsData,
  MetricData,
  LeaderboardEntry,
  RecommendationData,
  TopDomainData,
  TrendData
} from '@/firebase/firestore/dashboardData';

interface DashboardData {
  metrics: MetricData[];
  leaderboard: LeaderboardEntry[];
  recommendations: RecommendationData[];
  topDomains: TopDomainData[];
  trendData: TrendData[];
  brandPrompts: LeaderboardEntry[];
}

interface UseDashboardDataReturn {
  data: DashboardData;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  isGeneratingData: boolean;
  generationStatus: string;
}

export function useDashboardData(): UseDashboardDataReturn {
  const { user } = useAuthContext();
  const { selectedBrandId, loading: brandLoading } = useBrandContext();
  const [data, setData] = useState<DashboardData>({
    metrics: [],
    leaderboard: [],
    recommendations: [],
    topDomains: [],
    trendData: [],
    brandPrompts: []
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isGeneratingData, setIsGeneratingData] = useState(false);
  const [generationStatus, setGenerationStatus] = useState('');

  const fetchAllData = useCallback(async () => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    // Don't fetch if brands are still loading
    if (brandLoading) {
      return;
    }

    setLoading(true);
    setError(null);

    console.log('🔍 Fetching dashboard data for:', {
      userId: user.uid,
      selectedBrandId,
      hasSelectedBrand: !!selectedBrandId
    });

    try {
      // Fetch all data in parallel for better performance
      const [
        metricsResult,
        leaderboardResult,
        recommendationsResult,
        topDomainsResult,
        trendDataResult,
        brandPromptsResult
      ] = await Promise.all([
        getUserMetrics(user.uid, selectedBrandId || undefined),
        getLeaderboardData(),
        getUserRecommendations(user.uid, selectedBrandId || undefined),
        getUserTopDomains(user.uid, selectedBrandId || undefined),
        getUserTrendData(user.uid, selectedBrandId || undefined),
        getBrandPromptsData(user.uid, selectedBrandId || undefined)
      ]);

      console.log('📊 Dashboard data results:', {
        metrics: metricsResult.result?.length || 0,
        leaderboard: leaderboardResult.result?.length || 0,
        recommendations: recommendationsResult.result?.length || 0,
        topDomains: topDomainsResult.result?.length || 0,
        trendData: trendDataResult.result?.length || 0,
        brandPrompts: brandPromptsResult.result?.length || 0,
        metricsData: metricsResult.result,
        metricsError: metricsResult.error,
        hasSelectedBrand: !!selectedBrandId,
        selectedBrandId: selectedBrandId
      });

      // Check for errors
      const errors = [
        metricsResult.error,
        leaderboardResult.error,
        recommendationsResult.error,
        topDomainsResult.error,
        trendDataResult.error,
        brandPromptsResult.error
      ].filter(Boolean);

      if (errors.length > 0) {
        console.error('Dashboard data fetch errors:', errors);
        
        // Check if any errors are related to missing indexes
        const indexErrors = errors.filter(error => 
          error && error.code === 'failed-precondition' && 
          error.message?.includes('requires an index')
        );
        
        if (indexErrors.length > 0) {
          setError('Database indexes are being built. This may take a few minutes. Please try again shortly.');
        } else {
          setError('Some dashboard data could not be loaded. Please refresh the page.');
        }
      }

      // Update state with fetched data (use empty arrays for failed requests)
      setData({
        metrics: metricsResult.result || [],
        leaderboard: leaderboardResult.result || [],
        recommendations: recommendationsResult.result || [],
        topDomains: topDomainsResult.result || [],
        trendData: trendDataResult.result || [],
        brandPrompts: brandPromptsResult.result || []
      });

    } catch (err) {
      console.error('Dashboard data fetch error:', err);
      setError('Failed to load dashboard data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [user?.uid, selectedBrandId, brandLoading]);

  // Initial data fetch
  useEffect(() => {
    fetchAllData();
  }, [user?.uid, selectedBrandId, brandLoading, fetchAllData]);

  return {
    data,
    loading,
    error,
    refetch: fetchAllData,
    isGeneratingData,
    generationStatus
  };
} 