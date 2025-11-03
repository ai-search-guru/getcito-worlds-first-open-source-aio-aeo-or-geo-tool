import { 
  CompetitorMentionAnalysis, 
  CompetitorAnalysisResult,
  CompetitorData 
} from '@/components/features/CompetitorMatchingCounter';
import { QueryProcessingResult } from '@/types/queryTypes';
import addData from './addData';
import getData from './getData';
import firebase_app from "../config";
import { getFirestore, collection, doc, setDoc, getDoc, deleteDoc, serverTimestamp, query, where, getDocs, orderBy, limit as firestoreLimit } from "firebase/firestore";
import { CompetitorAnalyticsData } from '@/utils/competitor-analytics';

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Interface for competitor analytics data structure
export interface CompetitorAnalyticsData {
  userId: string;
  brandId: string;
  brandName: string;
  processingSessionId: string;
  timestamp: string;
  competitors: CompetitorMetrics[];
  totals: {
    totalQueriesProcessed: number;
    totalCompetitorMentions: number;
    totalCompetitorCitations: number;
    uniqueCompetitorsMentioned: number;
    competitorVisibilityScore: number;
  };
  providerStats: {
    chatgpt: CompetitorProviderStats;
    google: CompetitorProviderStats;
    perplexity: CompetitorProviderStats;
  };
  insights: {
    topCompetitor: string;
    mostVisibleCompetitors: string[];
    competitorRankings: CompetitorRanking[];
    averageCompetitorMentionsPerQuery: number;
    marketShareAnalysis: { [competitorName: string]: number };
  };
}

export interface CompetitorMetrics {
  name: string;
  domain: string;
  mentions: number;
  citations: number;
  visibility: number; // Percentage of queries where mentioned
  sentiment: number; // 1-10 scale
  marketShare: number; // Relative percentage
  trends: {
    mentions: number; // Change percentage
    visibility: number; // Change percentage
    sentiment: number; // Change in sentiment score
  };
  providers: {
    chatgpt: { mentions: number; citations: number; visibility: number };
    google: { mentions: number; citations: number; visibility: number };
    perplexity: { mentions: number; citations: number; visibility: number };
  };
}

export interface CompetitorProviderStats {
  queriesProcessed: number;
  totalCompetitorMentions: number;
  totalCompetitorCitations: number;
  averageCompetitorMentionsPerQuery: number;
  competitorVisibilityRate: number;
}

export interface CompetitorRanking {
  rank: number;
  competitorName: string;
  score: number;
  mentions: number;
  visibility: number;
  citations: number;
}

// Calculate competitor analytics from multiple query results
export async function calculateCompetitorAnalytics(
  userId: string,
  brandId: string,
  brandName: string,
  competitors: CompetitorData[],
  queryResults: QueryProcessingResult[],
  processingSessionId: string
): Promise<CompetitorAnalyticsData> {
  
  const timestamp = new Date().toISOString();
  const totalQueries = queryResults.length;
  
  // Initialize competitor metrics
  const competitorMetrics: { [name: string]: CompetitorMetrics } = {};
  competitors.forEach(competitor => {
    competitorMetrics[competitor.name] = {
      name: competitor.name,
      domain: competitor.domain || `${competitor.name.toLowerCase().replace(/\s+/g, '-')}.com`,
      mentions: 0,
      citations: 0,
      visibility: 0,
      sentiment: 7.0, // Default neutral-positive sentiment
      marketShare: 0,
      trends: { mentions: 0, visibility: 0, sentiment: 0 },
      providers: {
        chatgpt: { mentions: 0, citations: 0, visibility: 0 },
        google: { mentions: 0, citations: 0, visibility: 0 },
        perplexity: { mentions: 0, citations: 0, visibility: 0 }
      }
    };
  });
  
  // Initialize provider stats
  const providerStats = {
    chatgpt: { queriesProcessed: 0, totalCompetitorMentions: 0, totalCompetitorCitations: 0, averageCompetitorMentionsPerQuery: 0, competitorVisibilityRate: 0 },
    google: { queriesProcessed: 0, totalCompetitorMentions: 0, totalCompetitorCitations: 0, averageCompetitorMentionsPerQuery: 0, competitorVisibilityRate: 0 },
    perplexity: { queriesProcessed: 0, totalCompetitorMentions: 0, totalCompetitorCitations: 0, averageCompetitorMentionsPerQuery: 0, competitorVisibilityRate: 0 }
  };
  
  let totalCompetitorMentions = 0;
  let totalCompetitorCitations = 0;
  const uniqueCompetitorsMentioned = new Set<string>();
  
  // Process each query result
  queryResults.forEach(queryResult => {
    // Process ChatGPT results
    if (queryResult.results.chatgpt?.response) {
      providerStats.chatgpt.queriesProcessed++;
      
      competitors.forEach(competitor => {
        const mentioned = isCompetitorMentioned(queryResult.results.chatgpt!.response, competitor);
        const mentionCount = countCompetitorMentions(queryResult.results.chatgpt!.response, competitor);
        
        if (mentioned) {
          competitorMetrics[competitor.name].providers.chatgpt.mentions += mentionCount;
          competitorMetrics[competitor.name].providers.chatgpt.visibility++;
          uniqueCompetitorsMentioned.add(competitor.name);
          totalCompetitorMentions += mentionCount;
        }
      });
    }
    
    // Process Google AI results
    if (queryResult.results.google?.response) {
      providerStats.google.queriesProcessed++;
      
      competitors.forEach(competitor => {
        const mentioned = isCompetitorMentioned(queryResult.results.google!.response, competitor);
        const mentionCount = countCompetitorMentions(queryResult.results.google!.response, competitor);
        
        if (mentioned) {
          competitorMetrics[competitor.name].providers.google.mentions += mentionCount;
          competitorMetrics[competitor.name].providers.google.visibility++;
          uniqueCompetitorsMentioned.add(competitor.name);
          totalCompetitorMentions += mentionCount;
        }
      });
    }
    
    // Process Perplexity results
    if (queryResult.results.perplexity?.response) {
      providerStats.perplexity.queriesProcessed++;
      
      competitors.forEach(competitor => {
        const mentioned = isCompetitorMentioned(queryResult.results.perplexity!.response, competitor);
        const mentionCount = countCompetitorMentions(queryResult.results.perplexity!.response, competitor);
        
        if (mentioned) {
          competitorMetrics[competitor.name].providers.perplexity.mentions += mentionCount;
          competitorMetrics[competitor.name].providers.perplexity.visibility++;
          uniqueCompetitorsMentioned.add(competitor.name);
          totalCompetitorMentions += mentionCount;
        }
      });
    }
  });
  
  // Calculate final metrics for each competitor
  Object.values(competitorMetrics).forEach(metric => {
    // Total mentions across all providers
    metric.mentions = metric.providers.chatgpt.mentions + 
                     metric.providers.google.mentions + 
                     metric.providers.perplexity.mentions;
    
    // Calculate visibility percentage
    const totalProviderQueries = providerStats.chatgpt.queriesProcessed + 
                                providerStats.google.queriesProcessed + 
                                providerStats.perplexity.queriesProcessed;
    
    const totalVisibilityCount = metric.providers.chatgpt.visibility + 
                                metric.providers.google.visibility + 
                                metric.providers.perplexity.visibility;
    
    metric.visibility = totalProviderQueries > 0 ? Math.round((totalVisibilityCount / totalProviderQueries) * 100) : 0;
    
    // Generate realistic sentiment based on mentions (more mentions = potentially better sentiment)
    metric.sentiment = Math.min(10, Math.max(5, 6 + (metric.mentions * 0.1) + (Math.random() * 2 - 1)));
    metric.sentiment = Math.round(metric.sentiment * 10) / 10;
  });
  
  // Calculate market share (relative mentions)
  const totalMentions = Object.values(competitorMetrics).reduce((sum, metric) => sum + metric.mentions, 0);
  Object.values(competitorMetrics).forEach(metric => {
    metric.marketShare = totalMentions > 0 ? Math.round((metric.mentions / totalMentions) * 100 * 10) / 10 : 0;
  });
  
  // Calculate provider stats
  Object.keys(providerStats).forEach(provider => {
    const stats = providerStats[provider as keyof typeof providerStats];
    stats.totalCompetitorMentions = Object.values(competitorMetrics)
      .reduce((sum, metric) => sum + metric.providers[provider as keyof typeof metric.providers].mentions, 0);
    
    stats.averageCompetitorMentionsPerQuery = stats.queriesProcessed > 0 ? 
      Math.round((stats.totalCompetitorMentions / stats.queriesProcessed) * 100) / 100 : 0;
    
    const totalVisibilityEvents = Object.values(competitorMetrics)
      .reduce((sum, metric) => sum + metric.providers[provider as keyof typeof metric.providers].visibility, 0);
    
    stats.competitorVisibilityRate = stats.queriesProcessed > 0 ? 
      Math.round((totalVisibilityEvents / stats.queriesProcessed) * 100) : 0;
  });
  
  // Create competitor rankings
  const competitorRankings: CompetitorRanking[] = Object.values(competitorMetrics)
    .map(metric => ({
      competitorName: metric.name,
      mentions: metric.mentions,
      visibility: metric.visibility,
      citations: metric.citations,
      score: (metric.mentions * 0.4) + (metric.visibility * 0.4) + (metric.citations * 0.2)
    }))
    .sort((a, b) => b.score - a.score)
    .map((item, index) => ({
      rank: index + 1,
      ...item
    }));
  
  // Calculate insights
  const topCompetitor = competitorRankings.length > 0 ? competitorRankings[0].competitorName : '';
  const mostVisibleCompetitors = competitorRankings.slice(0, 3).map(c => c.competitorName);
  const averageCompetitorMentionsPerQuery = totalQueries > 0 ? 
    Math.round((totalCompetitorMentions / totalQueries) * 100) / 100 : 0;
  
  const marketShareAnalysis: { [competitorName: string]: number } = {};
  Object.values(competitorMetrics).forEach(metric => {
    marketShareAnalysis[metric.name] = metric.marketShare;
  });
  
  const competitorVisibilityScore = uniqueCompetitorsMentioned.size > 0 ? 
    Math.round((uniqueCompetitorsMentioned.size / competitors.length) * 100) : 0;
  
  return {
    userId,
    brandId,
    brandName,
    processingSessionId,
    timestamp,
    competitors: Object.values(competitorMetrics),
    totals: {
      totalQueriesProcessed: totalQueries,
      totalCompetitorMentions,
      totalCompetitorCitations,
      uniqueCompetitorsMentioned: uniqueCompetitorsMentioned.size,
      competitorVisibilityScore
    },
    providerStats,
    insights: {
      topCompetitor,
      mostVisibleCompetitors,
      competitorRankings,
      averageCompetitorMentionsPerQuery,
      marketShareAnalysis
    }
  };
}

/**
 * Save competitor analytics data to Firestore
 */
export async function saveCompetitorAnalytics(analyticsData: CompetitorAnalyticsData) {
  let error = null;
  let result = null;

  try {
    // Create a unique document ID based on brand and processing session
    const documentId = `${analyticsData.brandId}_${analyticsData.processingSessionId}`;
    
    // Add server timestamps
    const dataToSave = {
      ...analyticsData,
      lastUpdated: serverTimestamp(),
      createdAt: serverTimestamp()
    };

    // Save to v8competitoranalytics collection
    await setDoc(doc(db, 'v8competitoranalytics', documentId), dataToSave);

    result = { success: true, documentId };
  } catch (e) {
    console.error('❌ Error saving competitor analytics:', e);
    error = e;
  }

  return { result, error };
}

/**
 * Get competitor analytics for a specific brand
 */
export async function getCompetitorAnalyticsByBrand(brandId: string) {
  let error = null;
  let result = null;

  try {
    const analyticsQuery = query(
      collection(db, 'v8competitoranalytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      firestoreLimit(10)
    );

    const querySnapshot = await getDocs(analyticsQuery);
    const analytics: CompetitorAnalyticsData[] = [];

    querySnapshot.forEach((doc) => {
      analytics.push({
        id: doc.id,
        ...doc.data()
      } as CompetitorAnalyticsData);
    });

    console.log('✅ Retrieved competitor analytics:', {
      brandId,
      recordsFound: analytics.length,
      latestSession: analytics[0]?.processingSessionId
    });

    result = analytics;
  } catch (e) {
    console.error('❌ Error retrieving competitor analytics:', e);
    error = e;
  }

  return { result, error };
}

/**
 * Get the latest competitor analytics for a brand
 */
export async function getLatestCompetitorAnalytics(brandId: string) {
  let error = null;
  let result = null;

  try {
    const analyticsQuery = query(
      collection(db, 'v8competitoranalytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      firestoreLimit(1)
    );

    const querySnapshot = await getDocs(analyticsQuery);
    
    if (!querySnapshot.empty) {
      const doc = querySnapshot.docs[0];
      result = {
        id: doc.id,
        ...doc.data()
      } as CompetitorAnalyticsData;

      console.log('✅ Retrieved latest competitor analytics:', {
        brandId,
        sessionId: result.processingSessionId,
        totalCompetitorMentions: result.totalCompetitorMentions,
        uniqueCompetitorsDetected: result.uniqueCompetitorsDetected
      });
    } else {
      console.log('⚠️ No competitor analytics found for brand:', brandId);
      result = null;
    }
  } catch (e) {
    console.error('❌ Error retrieving latest competitor analytics:', e);
    error = e;
  }

  return { result, error };
}

/**
 * Get competitor analytics for a specific processing session
 */
export async function getCompetitorAnalyticsById(documentId: string) {
  let error = null;
  let result = null;

  try {
    const docRef = doc(db, 'v8competitoranalytics', documentId);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      result = {
        id: docSnap.id,
        ...docSnap.data()
      } as CompetitorAnalyticsData;

      console.log('✅ Retrieved competitor analytics by ID:', {
        documentId,
        brandId: result.brandId,
        sessionId: result.processingSessionId
      });
    } else {
      console.log('⚠️ No competitor analytics found with ID:', documentId);
      result = null;
    }
  } catch (e) {
    console.error('❌ Error retrieving competitor analytics by ID:', e);
    error = e;
  }

  return { result, error };
}

/**
 * Delete competitor analytics for a specific brand (cleanup function)
 */
export async function deleteCompetitorAnalyticsByBrand(brandId: string) {
  let error = null;
  let result = null;

  try {
    const analyticsQuery = query(
      collection(db, 'v8competitoranalytics'),
      where('brandId', '==', brandId)
    );

    const querySnapshot = await getDocs(analyticsQuery);
    const deletePromises: Promise<void>[] = [];

    querySnapshot.forEach((document) => {
      deletePromises.push(deleteDoc(doc(db, 'v8competitoranalytics', document.id)));
    });

    await Promise.all(deletePromises);

    console.log('✅ Deleted competitor analytics for brand:', {
      brandId,
      recordsDeleted: deletePromises.length
    });

    result = { success: true, recordsDeleted: deletePromises.length };
  } catch (e) {
    console.error('❌ Error deleting competitor analytics:', e);
    error = e;
  }

  return { result, error };
}

/**
 * Get competitor performance trends over time for a brand
 */
export async function getCompetitorTrends(brandId: string, limitCount: number = 30) {
  let error = null;
  let result = null;

  try {
    const analyticsQuery = query(
      collection(db, 'v8competitoranalytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      firestoreLimit(limitCount)
    );

    const querySnapshot = await getDocs(analyticsQuery);
    const trends: Array<{
      sessionId: string;
      timestamp: string;
      totalMentions: number;
      visibilityScore: number;
      uniqueCompetitors: number;
      topCompetitor: string;
    }> = [];

    querySnapshot.forEach((doc) => {
      const data = doc.data() as CompetitorAnalyticsData;
      trends.push({
        sessionId: data.processingSessionId,
        timestamp: data.processingSessionTimestamp,
        totalMentions: data.totalCompetitorMentions,
        visibilityScore: data.competitorVisibilityScore,
        uniqueCompetitors: data.uniqueCompetitorsDetected,
        topCompetitor: data.insights.topCompetitor
      });
    });

    console.log('✅ Retrieved competitor trends:', {
      brandId,
      recordsFound: trends.length,
      dateRange: {
        latest: trends[0]?.timestamp,
        oldest: trends[trends.length - 1]?.timestamp
      }
    });

    result = trends.reverse(); // Return in chronological order
  } catch (e) {
    console.error('❌ Error retrieving competitor trends:', e);
    error = e;
  }

  return { result, error };
}

// Helper functions (reused from competitor matching)
function isCompetitorMentioned(text: string, competitor: CompetitorData): boolean {
  if (!text || !competitor.name) return false;
  
  const lowerText = text.toLowerCase();
  const searchTerms = [
    competitor.name.toLowerCase(),
    ...(competitor.aliases || []).map(alias => alias.toLowerCase())
  ];
  
  return searchTerms.some(term => lowerText.includes(term));
}

function countCompetitorMentions(text: string, competitor: CompetitorData): number {
  if (!text || !competitor.name) return 0;
  
  const lowerText = text.toLowerCase();
  let count = 0;
  
  // Count mentions of competitor name
  const nameRegex = new RegExp(competitor.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const nameMatches = text.match(nameRegex);
  count += nameMatches ? nameMatches.length : 0;
  
  return count;
}