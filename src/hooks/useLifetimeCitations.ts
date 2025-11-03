'use client'
import { useState, useEffect, useCallback } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { collection, query, where, orderBy, limit, getDocs, getFirestore } from 'firebase/firestore';
import firebase_app from '@/firebase/config';
import type { LifetimeBrandAnalytics, LifetimeCitation } from '@/firebase/firestore/brandAnalytics';

const db = getFirestore(firebase_app);

interface UseLifetimeCitationsOptions {
  brandId?: string;
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseLifetimeCitationsReturn {
  citations: LifetimeCitation[];
  loading: boolean;
  error: string | null;
  analytics: LifetimeBrandAnalytics | null;
  refetch: () => Promise<void>;
  stats: {
    totalCitations: number;
    uniqueDomains: number;
    brandMentions: number;
    domainCitations: number;
    byProvider: {
      chatgpt: number;
      googleAI: number;
      perplexity: number;
    };
  };
}

export function useLifetimeCitations(options: UseLifetimeCitationsOptions = {}): UseLifetimeCitationsReturn {
  const { user } = useAuthContext();
  const [citations, setCitations] = useState<LifetimeCitation[]>([]);
  const [analytics, setAnalytics] = useState<LifetimeBrandAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { brandId, autoRefresh = false, refreshInterval = 30000 } = options;

  // Fetch lifetime citations from analytics collection
  const fetchLifetimeCitations = useCallback(async () => {
    if (!user?.uid || !brandId) {
      setCitations([]);
      setAnalytics(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      
      console.log('🔍 Fetching lifetime citations for brandId:', brandId);
      
      // Query the v8_lifetime_brand_analytics collection for the latest analytics data for this brand
      const analyticsQuery = query(
        collection(db, 'v8_lifetime_brand_analytics'),
        where('brandId', '==', brandId),
        orderBy('calculatedAt', 'desc'),
        limit(1)
      );
      
      const analyticsSnapshot = await getDocs(analyticsQuery);
      
      if (analyticsSnapshot.empty) {
        console.log('⚠️ No lifetime analytics found for brand:', brandId);
        setCitations([]);
        setAnalytics(null);
        return;
      }
      
      let latestAnalytics = analyticsSnapshot.docs[0].data() as LifetimeBrandAnalytics;
      console.log('✅ Found lifetime analytics with', latestAnalytics.allCitations?.length || 0, 'citations');
      
      // Check if data is stored in Cloud Storage and retrieve full data
      if ((latestAnalytics as any).storedInCloudStorage && (latestAnalytics as any).storageRef && (!latestAnalytics.allCitations || latestAnalytics.allCitations.length === 0)) {
        try {
          console.log('🔍 Analytics data stored in Cloud Storage, retrieving full dataset...');
          const { retrieveLargeData } = await import('@/firebase/storage/cloudStorage');
          
          // Create storage reference object for direct retrieval
          const storageRef = {
            storageId: (latestAnalytics as any).storageRef,
            storagePath: (latestAnalytics as any).storageRef,
            downloadUrl: '', // Will be generated during retrieval
            size: 0,
            contentType: 'application/json',
            uploadedAt: null
          };
          
          const { data: fullAnalyticsData, error: storageError } = await retrieveLargeData(storageRef);
          
          if (storageError) {
            throw storageError;
          }
          
          if (fullAnalyticsData?.allCitations) {
            latestAnalytics.allCitations = fullAnalyticsData.allCitations;
            console.log(`✅ Retrieved ${fullAnalyticsData.allCitations.length} citations from Cloud Storage`);
          } else {
            console.warn('⚠️ No citations found in Cloud Storage, using Firestore data');
          }
        } catch (storageError) {
          console.warn('⚠️ Failed to retrieve full analytics from Cloud Storage:', storageError);
          console.log('📋 Using limited Firestore data with', latestAnalytics.allCitations?.length || 0, 'citations');
        }
      }
      
      setAnalytics(latestAnalytics);
      setCitations(latestAnalytics.allCitations || []);
      
    } catch (error) {
      console.error('❌ Error fetching lifetime citations:', error);
      setError(error instanceof Error ? error.message : 'Failed to fetch lifetime citations');
      setCitations([]);
      setAnalytics(null);
    } finally {
      setLoading(false);
    }
  }, [user?.uid, brandId]);

  // Initial fetch
  useEffect(() => {
    fetchLifetimeCitations();
  }, [fetchLifetimeCitations]);

  // Auto-refresh if enabled
  useEffect(() => {
    if (!autoRefresh || !brandId) return;

    const interval = setInterval(() => {
      fetchLifetimeCitations();
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, brandId, fetchLifetimeCitations]);

  // Calculate stats from citations
  const stats = {
    totalCitations: citations.length,
    uniqueDomains: new Set(citations.map(c => c.domain)).size,
    brandMentions: citations.filter(c => c.isBrandMention).length,
    domainCitations: citations.filter(c => c.isDomainCitation).length,
    byProvider: {
      chatgpt: citations.filter(c => c.provider === 'chatgpt').length,
      googleAI: citations.filter(c => c.provider === 'googleAI').length,
      perplexity: citations.filter(c => c.provider === 'perplexity').length,
    }
  };

  return {
    citations,
    loading,
    error,
    analytics,
    refetch: fetchLifetimeCitations,
    stats
  };
} 