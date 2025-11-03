import { useState, useEffect, useCallback } from 'react';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import { getLatestCompetitorAnalytics } from '@/firebase/firestore/competitorAnalytics';
import { CompetitorAnalyticsData } from '@/utils/competitor-analytics';

interface CompetitorData {
  id: string;
  name: string;
  domain?: string;
  mentions: number;
  visibility: number;
  queriesAnalyzed: number;
  topProvider: string;
  lastUpdated: string;
}

interface UseCompetitorsReturn {
  competitors: CompetitorData[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useCompetitors(): UseCompetitorsReturn {
  const { user } = useAuthContext();
  const { selectedBrand, selectedBrandId, loading: brandLoading } = useBrandContext();
  const [competitors, setCompetitors] = useState<CompetitorData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompetitors = useCallback(async () => {
    if (!user?.uid || !selectedBrandId || brandLoading || !selectedBrand) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch real competitor analytics from Firestore
      const { result: analyticsData, error: analyticsError } = await getLatestCompetitorAnalytics(selectedBrandId);
      
      if (analyticsError) {
        throw new Error(analyticsError as string);
      }

      if (!analyticsData) {
        // No competitor analytics data yet - show empty state
        setCompetitors([]);
        setLoading(false);
        return;
      }

      // Transform analytics data into competitor display format
      const competitorData: CompetitorData[] = Object.entries(analyticsData.competitorStats).map(([name, stats], index) => ({
        id: (index + 1).toString(),
        name,
        domain: undefined, // Will be enhanced in future iterations
        mentions: stats.totalMentions,
        visibility: Math.round(stats.visibilityScore),
        queriesAnalyzed: analyticsData.totalQueriesProcessed,
        topProvider: stats.topProvider,
        lastUpdated: analyticsData.processingSessionTimestamp
      }));

      setCompetitors(competitorData);
    } catch (err) {
      console.error('Error fetching competitors:', err);
      setError('Failed to load competitor analytics. Please process some queries first.');
      setCompetitors([]);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, selectedBrandId, brandLoading, selectedBrand]);

  useEffect(() => {
    fetchCompetitors();
  }, [fetchCompetitors]);

  return {
    competitors,
    loading,
    error,
    refetch: fetchCompetitors
  };
} 