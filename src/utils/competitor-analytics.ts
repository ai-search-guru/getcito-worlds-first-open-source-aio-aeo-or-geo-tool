import { Competitor, MatchResult, matchCompetitorsInText } from '@/lib/competitor-matching';

export interface CompetitorAnalyticsData {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Processing session information
  processingSessionId: string;
  processingSessionTimestamp: string;
  totalQueriesProcessed: number;
  
  // Competitor-specific metrics
  totalCompetitorMentions: number;
  competitorVisibilityScore: number; // Percentage of queries mentioning competitors
  uniqueCompetitorsDetected: number;
  
  // Per-competitor breakdown
  competitorStats: {
    [competitorName: string]: {
      totalMentions: number;
      visibilityScore: number; // Percentage of queries mentioning this competitor
      mentionTrend: 'increasing' | 'decreasing' | 'stable';
      averageMentionsPerQuery: number;
      topProvider: string; // Provider that mentions this competitor most
      providerBreakdown: {
        chatgpt: { mentions: number; queriesWithMentions: number };
        google: { mentions: number; queriesWithMentions: number };
        perplexity: { mentions: number; queriesWithMentions: number };
      };
    };
  };
  
  // Provider-specific aggregated data
  providerStats: {
    chatgpt: {
      queriesProcessed: number;
      competitorMentions: number;
      uniqueCompetitors: number;
    };
    google: {
      queriesProcessed: number;
      competitorMentions: number;
      uniqueCompetitors: number;
    };
    perplexity: {
      queriesProcessed: number;
      competitorMentions: number;
      uniqueCompetitors: number;
    };
  };
  
  // Insights
  insights: {
    topCompetitor: string; // Most mentioned competitor
    mostCompetitiveProvider: string; // Provider that mentions most competitors
    averageCompetitorsPerQuery: number;
    competitiveIntensity: 'low' | 'medium' | 'high'; // Based on competitor mention frequency
    marketPosition: 'leader' | 'challenger' | 'follower'; // Based on relative mention frequency
  };
  
  // Timestamps
  lastUpdated: any;
  createdAt: any;
}

export interface CompetitorAnalysisResult {
  provider: 'chatgpt' | 'google' | 'perplexity';
  competitors: {
    [competitorName: string]: {
      mentioned: boolean;
      mentionCount: number;
      matchResults: MatchResult[];
    };
  };
  totalCompetitorMentions: number;
  uniqueCompetitorsDetected: number;
}

/**
 * Analyze competitor mentions in a single query across all providers
 */
export function analyzeCompetitorMentionsInQuery(
  competitors: Competitor[],
  queryResults: {
    chatgpt?: { response: string };
    googleAI?: { aiOverview?: string };
    perplexity?: { response: string };
  }
): { [provider: string]: CompetitorAnalysisResult } {
  const results: { [provider: string]: CompetitorAnalysisResult } = {};
  
  // Analyze ChatGPT
  if (queryResults.chatgpt?.response) {
    const matches = matchCompetitorsInText(queryResults.chatgpt.response, competitors);
    const competitorData: { [name: string]: { mentioned: boolean; mentionCount: number; matchResults: MatchResult[] } } = {};
    
    // Initialize all competitors
    competitors.forEach(comp => {
      competitorData[comp.name] = { mentioned: false, mentionCount: 0, matchResults: [] };
    });
    
    // Process matches
    matches.forEach(match => {
      const compName = match.competitor.name;
      competitorData[compName].mentioned = true;
      competitorData[compName].mentionCount++;
      competitorData[compName].matchResults.push(match);
    });
    
    results.chatgpt = {
      provider: 'chatgpt',
      competitors: competitorData,
      totalCompetitorMentions: matches.length,
      uniqueCompetitorsDetected: Object.values(competitorData).filter(c => c.mentioned).length
    };
  }
  
  // Analyze Google AI Overview
  if (queryResults.googleAI?.aiOverview) {
    const matches = matchCompetitorsInText(queryResults.googleAI.aiOverview, competitors);
    const competitorData: { [name: string]: { mentioned: boolean; mentionCount: number; matchResults: MatchResult[] } } = {};
    
    competitors.forEach(comp => {
      competitorData[comp.name] = { mentioned: false, mentionCount: 0, matchResults: [] };
    });
    
    matches.forEach(match => {
      const compName = match.competitor.name;
      competitorData[compName].mentioned = true;
      competitorData[compName].mentionCount++;
      competitorData[compName].matchResults.push(match);
    });
    
    results.google = {
      provider: 'google',
      competitors: competitorData,
      totalCompetitorMentions: matches.length,
      uniqueCompetitorsDetected: Object.values(competitorData).filter(c => c.mentioned).length
    };
  }
  
  // Analyze Perplexity
  if (queryResults.perplexity?.response) {
    const matches = matchCompetitorsInText(queryResults.perplexity.response, competitors);
    const competitorData: { [name: string]: { mentioned: boolean; mentionCount: number; matchResults: MatchResult[] } } = {};
    
    competitors.forEach(comp => {
      competitorData[comp.name] = { mentioned: false, mentionCount: 0, matchResults: [] };
    });
    
    matches.forEach(match => {
      const compName = match.competitor.name;
      competitorData[compName].mentioned = true;
      competitorData[compName].mentionCount++;
      competitorData[compName].matchResults.push(match);
    });
    
    results.perplexity = {
      provider: 'perplexity',
      competitors: competitorData,
      totalCompetitorMentions: matches.length,
      uniqueCompetitorsDetected: Object.values(competitorData).filter(c => c.mentioned).length
    };
  }
  
  return results;
}

/**
 * Calculate cumulative competitor analytics from multiple query results
 */
export function calculateCumulativeCompetitorAnalytics(
  userId: string,
  brandId: string,
  brandName: string,
  brandDomain: string,
  processingSessionId: string,
  processingSessionTimestamp: string,
  competitors: Competitor[],
  queryResults: any[]
): CompetitorAnalyticsData {
  // Initialize counters
  let totalCompetitorMentions = 0;
  let queriesWithCompetitorMentions = 0;
  const competitorStats: { [name: string]: any } = {};
  const providerStats = {
    chatgpt: { queriesProcessed: 0, competitorMentions: 0, uniqueCompetitors: new Set() },
    google: { queriesProcessed: 0, competitorMentions: 0, uniqueCompetitors: new Set() },
    perplexity: { queriesProcessed: 0, competitorMentions: 0, uniqueCompetitors: new Set() }
  };
  
  // Initialize competitor stats
  competitors.forEach(comp => {
    competitorStats[comp.name] = {
      totalMentions: 0,
      queriesWithMentions: 0,
      providerBreakdown: {
        chatgpt: { mentions: 0, queriesWithMentions: 0 },
        google: { mentions: 0, queriesWithMentions: 0 },
        perplexity: { mentions: 0, queriesWithMentions: 0 }
      }
    };
  });
  
  // Process each query result
  queryResults.forEach(queryResult => {
    const queryAnalysis = analyzeCompetitorMentionsInQuery(competitors, {
      chatgpt: queryResult.results?.chatgpt ? { response: queryResult.results.chatgpt.response || '' } : undefined,
      googleAI: queryResult.results?.googleAI ? { aiOverview: queryResult.results.googleAI.aiOverview || '' } : undefined,
      perplexity: queryResult.results?.perplexity ? { response: queryResult.results.perplexity.response || '' } : undefined
    });
    
    let hasCompetitorMention = false;
    
    // Process results for each provider
    Object.entries(queryAnalysis).forEach(([providerKey, analysis]) => {
      const provider = providerKey as keyof typeof providerStats;
      providerStats[provider].queriesProcessed++;
      providerStats[provider].competitorMentions += analysis.totalCompetitorMentions;
      
      Object.entries(analysis.competitors).forEach(([compName, compData]) => {
        if (compData.mentioned) {
          hasCompetitorMention = true;
          providerStats[provider].uniqueCompetitors.add(compName);
          
          // Update competitor stats
          competitorStats[compName].totalMentions += compData.mentionCount;
          competitorStats[compName].providerBreakdown[provider].mentions += compData.mentionCount;
          
          if (compData.mentionCount > 0) {
            competitorStats[compName].queriesWithMentions++;
            competitorStats[compName].providerBreakdown[provider].queriesWithMentions++;
          }
        }
      });
      
      totalCompetitorMentions += analysis.totalCompetitorMentions;
    });
    
    if (hasCompetitorMention) {
      queriesWithCompetitorMentions++;
    }
  });
  
  // Calculate final metrics
  const competitorVisibilityScore = queryResults.length > 0 ? (queriesWithCompetitorMentions / queryResults.length) * 100 : 0;
  const uniqueCompetitorsDetected = Object.values(competitorStats).filter((stats: any) => stats.totalMentions > 0).length;
  
  // Finalize competitor stats
  Object.keys(competitorStats).forEach(compName => {
    const stats = competitorStats[compName];
    stats.visibilityScore = queryResults.length > 0 ? (stats.queriesWithMentions / queryResults.length) * 100 : 0;
    stats.averageMentionsPerQuery = queryResults.length > 0 ? stats.totalMentions / queryResults.length : 0;
    stats.mentionTrend = 'stable'; // Will be calculated by comparing with previous data
    
    // Determine top provider for this competitor
    const providers = ['chatgpt', 'google', 'perplexity'] as const;
    let topProvider = 'none';
    let maxMentions = 0;
    
    providers.forEach(provider => {
      const mentions = stats.providerBreakdown[provider].mentions;
      if (mentions > maxMentions) {
        maxMentions = mentions;
        topProvider = provider;
      }
    });
    
    stats.topProvider = topProvider;
  });
  
  // Calculate insights
  const topCompetitor = Object.entries(competitorStats)
    .sort(([,a], [,b]) => (b as any).totalMentions - (a as any).totalMentions)[0]?.[0] || 'none';
  
  const mostCompetitiveProvider = Object.entries(providerStats)
    .sort(([,a], [,b]) => b.competitorMentions - a.competitorMentions)[0]?.[0] || 'none';
  
  const averageCompetitorsPerQuery = queryResults.length > 0 ? uniqueCompetitorsDetected / queryResults.length : 0;
  
  let competitiveIntensity: 'low' | 'medium' | 'high' = 'low';
  if (competitorVisibilityScore > 60) competitiveIntensity = 'high';
  else if (competitorVisibilityScore > 30) competitiveIntensity = 'medium';
  
  let marketPosition: 'leader' | 'challenger' | 'follower' = 'follower';
  if (competitorVisibilityScore < 20) marketPosition = 'leader';
  else if (competitorVisibilityScore < 50) marketPosition = 'challenger';
  
  return {
    userId,
    brandId,
    brandName,
    brandDomain,
    processingSessionId,
    processingSessionTimestamp,
    totalQueriesProcessed: queryResults.length,
    totalCompetitorMentions,
    competitorVisibilityScore: Math.round(competitorVisibilityScore * 100) / 100,
    uniqueCompetitorsDetected,
    competitorStats: Object.fromEntries(
      Object.entries(competitorStats).map(([name, stats]) => [name, {
        ...stats,
        visibilityScore: Math.round((stats as any).visibilityScore * 100) / 100,
        averageMentionsPerQuery: Math.round((stats as any).averageMentionsPerQuery * 100) / 100
      }])
    ),
    providerStats: {
      chatgpt: {
        ...providerStats.chatgpt,
        uniqueCompetitors: providerStats.chatgpt.uniqueCompetitors.size
      },
      google: {
        ...providerStats.google,
        uniqueCompetitors: providerStats.google.uniqueCompetitors.size
      },
      perplexity: {
        ...providerStats.perplexity,
        uniqueCompetitors: providerStats.perplexity.uniqueCompetitors.size
      }
    },
    insights: {
      topCompetitor,
      mostCompetitiveProvider,
      averageCompetitorsPerQuery: Math.round(averageCompetitorsPerQuery * 100) / 100,
      competitiveIntensity,
      marketPosition
    },
    lastUpdated: new Date(),
    createdAt: new Date()
  };
} 