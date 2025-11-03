import firebase_app from "../config";
import { getFirestore, collection, doc, setDoc, getDoc, serverTimestamp, query, where, getDocs, orderBy, limit } from "firebase/firestore";
import { analyzeBrandMentions } from '@/components/features/BrandMentionCounter';
import { extractChatGPTCitations } from '@/components/features/ChatGPTResponseRenderer';
import { extractGoogleAIOverviewCitations } from '@/components/features/GoogleAIOverviewRenderer';
import { extractPerplexityCitations } from '@/components/features/PerplexityResponseRenderer';
import { getQueriesByBrand } from './userQueries';
import { getBrandInfo } from './brandDataService';
import { retrieveDocumentWithLargeData } from '../storage/cloudStorage';

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Interface for brand analytics data
export interface BrandAnalyticsData {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Processing session information
  processingSessionId: string;
  processingSessionTimestamp: string;
  totalQueriesProcessed: number;
  
  // Cumulative metrics across all queries in this session
  totalBrandMentions: number;
  brandVisibilityScore: number; // Calculated as (providers with brand mentions / total providers) across all queries
  totalCitations: number;
  totalDomainCitations: number;
  
  // Provider-specific aggregated data
  providerStats: {
    chatgpt: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    google: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    perplexity: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
  };
  
  // Additional insights
  insights: {
    topPerformingProvider: string; // Provider(s) with best performance (brand mentions -> domain citations ratio -> total citations)
    topProviders: string[]; // Array of top performing providers (useful for ties)
    brandVisibilityTrend: 'improving' | 'declining' | 'stable';
    averageBrandMentionsPerQuery: number;
    averageCitationsPerQuery: number;
    competitorMentionsDetected: number; // Future feature
    providerRankingDetails?: {
      [provider: string]: {
        rank: number;
        brandMentions: number;
        domainCitationsRatio: number;
        totalCitations: number;
      };
    };
  };
  
  // Timestamps
  lastUpdated: any;
  createdAt: any;
}

// Interface for individual citation data in lifetime analytics
export interface LifetimeCitation {
  id: string;
  url: string;
  text: string;
  source: string;
  provider: 'chatgpt' | 'perplexity' | 'googleAI';
  query: string;
  queryId: string;
  brandName: string;
  domain?: string;
  timestamp: string;
  type?: string;
  isBrandMention?: boolean;
  isDomainCitation?: boolean;
  processingSessionId: string;
}

// Interface for lifetime analytics data (aggregated across all historical queries)
export interface LifetimeBrandAnalytics {
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Lifetime aggregated metrics
  totalQueriesProcessed: number;
  totalProcessingSessions: number;
  totalBrandMentions: number;
  brandVisibilityScore: number;
  totalCitations: number;
  totalDomainCitations: number;
  
  // Individual citation data for detailed analysis
  allCitations: LifetimeCitation[];
  
  // Provider-specific lifetime data
  providerStats: {
    chatgpt: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    google: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
    perplexity: {
      queriesProcessed: number;
      brandMentions: number;
      citations: number;
      domainCitations: number;
      averageResponseTime?: number;
    };
  };
  
  // Lifetime insights
  insights: {
    topPerformingProvider: string;
    topProviders: string[];
    averageBrandMentionsPerQuery: number;
    averageCitationsPerQuery: number;
    firstQueryProcessed?: string;
    lastQueryProcessed?: string;
    providerRankingDetails?: {
      [provider: string]: {
        rank: number;
        brandMentions: number;
        domainCitationsRatio: number;
        totalCitations: number;
      };
    };
  };
  
  // Timestamps
  calculatedAt: any;
}

// Interface for historical analytics summary
export interface BrandAnalyticsHistory {
  brandId: string;
  totalSessions: number;
  latestAnalytics: BrandAnalyticsData;
  previousAnalytics?: BrandAnalyticsData;
  trend: {
    brandMentionsChange: number;
    citationsChange: number;
    visibilityChange: number;
  };
}

// Calculate cumulative analytics from query processing results
export function calculateCumulativeAnalytics(
  userId: string,
  brandId: string,
  brandName: string,
  brandDomain: string,
  processingSessionId: string,
  processingSessionTimestamp: string,
  queryResults: any[]
): BrandAnalyticsData {
  
  const providerStats = {
    chatgpt: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 },
    google: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 },
    perplexity: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0, totalResponseTime: 0 }
  };

  let totalBrandMentions = 0;
  let totalCitations = 0;
  let totalDomainCitations = 0;
  let totalProvidersWithBrandMentions = 0;
  let totalProviders = 0;

  // Process each query result
  queryResults.forEach(queryResult => {
    // Extract citations for each provider
    const chatgptCitations = queryResult.results?.chatgpt ? 
      extractChatGPTCitations(queryResult.results.chatgpt.response || '') : [];
    const googleCitations = queryResult.results?.googleAI ? 
      extractGoogleAIOverviewCitations(queryResult.results.googleAI.aiOverview || '', queryResult.results.googleAI) : [];
    const perplexityCitations = queryResult.results?.perplexity ? 
      extractPerplexityCitations(queryResult.results.perplexity.response || '', queryResult.results.perplexity) : [];

    // Analyze brand mentions for this query
    const analysis = analyzeBrandMentions(brandName, brandDomain, {
      chatgpt: queryResult.results?.chatgpt ? {
        response: queryResult.results.chatgpt.response || '',
        citations: chatgptCitations
      } : undefined,
      googleAI: queryResult.results?.googleAI ? {
        aiOverview: queryResult.results.googleAI.aiOverview || '',
        citations: googleCitations
      } : undefined,
      perplexity: queryResult.results?.perplexity ? {
        response: queryResult.results.perplexity.response || '',
        citations: perplexityCitations
      } : undefined
    });

    // Accumulate totals
    totalBrandMentions += analysis.totals.totalBrandMentions;
    totalCitations += analysis.totals.totalCitations;
    totalDomainCitations += analysis.totals.totalDomainCitations;
    totalProvidersWithBrandMentions += analysis.totals.providersWithBrandMention;
    totalProviders += Object.keys(analysis.results).length;

    // Update provider-specific stats
    Object.entries(analysis.results).forEach(([providerKey, result]) => {
      if (result) {
        const provider = providerKey as keyof typeof providerStats;
        providerStats[provider].queriesProcessed++;
        providerStats[provider].brandMentions += result.brandMentionCount;
        providerStats[provider].citations += result.citationCount;
        providerStats[provider].domainCitations += result.domainCitationCount;
        
        // Add response time if available
        const responseTime = queryResult.results?.[provider === 'google' ? 'googleAI' : provider]?.responseTime;
        if (responseTime) {
          providerStats[provider].totalResponseTime += responseTime;
        }
      }
    });
  });

  // Calculate averages and insights
  const brandVisibilityScore = totalProviders > 0 ? (totalProvidersWithBrandMentions / totalProviders) * 100 : 0;
  const averageBrandMentionsPerQuery = queryResults.length > 0 ? totalBrandMentions / queryResults.length : 0;
  const averageCitationsPerQuery = queryResults.length > 0 ? totalCitations / queryResults.length : 0;

  // Determine top performing provider with sophisticated ranking
  let topPerformingProvider = 'none';
  let topProviders: string[] = [];
  
  // Check if there's any meaningful brand performance to measure
  const hasBrandPerformance = totalBrandMentions > 0 || totalDomainCitations > 0;
  
  if (!hasBrandPerformance) {
    // No brand mentions or domain citations - no meaningful performance to rank
    topPerformingProvider = 'none';
    topProviders = [];
  } else {
    // Create array of providers with their performance metrics
    const providerRankings = Object.entries(providerStats)
      .filter(([_, stats]) => stats.queriesProcessed > 0) // Only consider providers that processed queries
      .map(([provider, stats]) => ({
        provider,
        brandMentions: stats.brandMentions,
        domainCitationsRatio: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
        totalCitations: stats.citations,
        domainCitations: stats.domainCitations
      }));

    if (providerRankings.length === 0) {
      topPerformingProvider = 'none';
      topProviders = [];
    } else {
      // Sort by: 1) Brand mentions (desc), 2) Domain citations ratio (desc), 3) Total citations (desc)
      providerRankings.sort((a, b) => {
        // Primary: Brand mentions
        if (a.brandMentions !== b.brandMentions) {
          return b.brandMentions - a.brandMentions;
        }
        
        // Secondary: Domain citations ratio
        if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) { // Use small epsilon for float comparison
          return b.domainCitationsRatio - a.domainCitationsRatio;
        }
        
        // Tertiary: Total citations
        return b.totalCitations - a.totalCitations;
      });

      const topProvider = providerRankings[0];
      
      // Additional check: Top provider must have at least 1 brand mention OR domain citation
      const topProviderHasPerformance = topProvider.brandMentions > 0 || topProvider.domainCitations > 0;
      
      if (!topProviderHasPerformance) {
        topPerformingProvider = 'none';
        topProviders = [];
      } else {
        // Check for ties - find all providers with same brand mentions and domain citations ratio
        const tiedProviders = providerRankings.filter(p => 
          p.brandMentions === topProvider.brandMentions && 
          Math.abs(p.domainCitationsRatio - topProvider.domainCitationsRatio) < 0.001 &&
          (p.brandMentions > 0 || p.domainCitations > 0) // Only include providers with actual performance
        );

        if (tiedProviders.length > 1) {
          // Multiple providers tied - show all of them
          topPerformingProvider = tiedProviders.map(p => p.provider).join(' & ');
          topProviders = tiedProviders.map(p => p.provider);
        } else {
          // Single top performer
          topPerformingProvider = topProvider.provider;
          topProviders = [topProvider.provider];
        }
      }
    }
  }

  // Calculate average response times (Firebase doesn't allow undefined values)
  const finalProviderStats = {
    chatgpt: {
      ...providerStats.chatgpt,
      ...(providerStats.chatgpt.queriesProcessed > 0 && {
        averageResponseTime: providerStats.chatgpt.totalResponseTime / providerStats.chatgpt.queriesProcessed
      })
    },
    google: {
      ...providerStats.google,
      ...(providerStats.google.queriesProcessed > 0 && {
        averageResponseTime: providerStats.google.totalResponseTime / providerStats.google.queriesProcessed
      })
    },
    perplexity: {
      ...providerStats.perplexity,
      ...(providerStats.perplexity.queriesProcessed > 0 && {
        averageResponseTime: providerStats.perplexity.totalResponseTime / providerStats.perplexity.queriesProcessed
      })
    }
  };

  // Remove totalResponseTime from final stats
  Object.values(finalProviderStats).forEach(stats => {
    delete (stats as any).totalResponseTime;
  });

  // Create provider ranking details for insights
  const providerRankingDetails: { [provider: string]: { rank: number; brandMentions: number; domainCitationsRatio: number; totalCitations: number; } } = {};
  const providerRankings = Object.entries(providerStats)
    .filter(([_, stats]) => stats.queriesProcessed > 0)
    .map(([provider, stats]) => ({
      provider,
      brandMentions: stats.brandMentions,
      domainCitationsRatio: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
      totalCitations: stats.citations,
      domainCitations: stats.domainCitations
    }))
    .sort((a, b) => {
      if (a.brandMentions !== b.brandMentions) return b.brandMentions - a.brandMentions;
      if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) return b.domainCitationsRatio - a.domainCitationsRatio;
      return b.totalCitations - a.totalCitations;
    });
    
  providerRankings.forEach((ranking, index) => {
    providerRankingDetails[ranking.provider] = {
      rank: index + 1,
      brandMentions: ranking.brandMentions,
      domainCitationsRatio: Math.round(ranking.domainCitationsRatio * 10000) / 100, // Convert to percentage with 2 decimal places
      totalCitations: ranking.totalCitations
    };
  });

  return {
    userId,
    brandId,
    brandName,
    brandDomain,
    processingSessionId,
    processingSessionTimestamp,
    totalQueriesProcessed: queryResults.length,
    totalBrandMentions,
    brandVisibilityScore: Math.round(brandVisibilityScore * 100) / 100, // Round to 2 decimal places
    totalCitations,
    totalDomainCitations,
    providerStats: finalProviderStats,
    insights: {
      topPerformingProvider,
      topProviders,
      brandVisibilityTrend: 'stable', // Will be calculated by comparing with previous data
      averageBrandMentionsPerQuery: Math.round(averageBrandMentionsPerQuery * 100) / 100,
      averageCitationsPerQuery: Math.round(averageCitationsPerQuery * 100) / 100,
      competitorMentionsDetected: 0, // Future feature
      providerRankingDetails
    },
    lastUpdated: serverTimestamp(),
    createdAt: serverTimestamp()
  };
}

// Calculate latest session analytics from brand document (unified data source)
export async function calculateLatestSessionFromBrandDocument(
  brandId: string
): Promise<{ result?: BrandAnalyticsData; error?: any }> {
  try {
    console.log('🔄 Calculating latest session analytics from brand document:', brandId);
    
    // Get brand information (same source as lifetime analytics)
    let brand = await getBrandInfo(brandId);
    if (!brand) {
      return { error: 'Brand not found' };
    }
    
    // If the brand document has storage references, retrieve full data from Cloud Storage
    if ((brand as any).storageReferences?.queryProcessingResults) {
      console.log('📥 Brand has Cloud Storage references, retrieving full query results for session analytics...');
      try {
        const { document: fullBrandData } = await retrieveDocumentWithLargeData(
          'v8userbrands', 
          brandId, 
          ['queryProcessingResults']
        );
        
        if (fullBrandData?.queryProcessingResults) {
          brand.queryProcessingResults = fullBrandData.queryProcessingResults;
          console.log(`✅ Retrieved ${fullBrandData.queryProcessingResults.length} query results from Cloud Storage for session analytics`);
        }
      } catch (storageError) {
        console.warn('⚠️ Failed to retrieve query results from Cloud Storage for session analytics:', storageError);
        // Continue with truncated data from Firestore
      }
    }
    
    const brandName = brand.companyName;
    const brandDomain = brand.domain;
    const userId = brand.userId;
    
    // Collect all query results from brand document
    let allQueryResults: any[] = [];
    
    // 1. Get results from brand document
    if (brand.queryProcessingResults && brand.queryProcessingResults.length > 0) {
      allQueryResults = [...brand.queryProcessingResults];
    }
    
    // 2. Try to get additional results from v8userqueries collection (fault-tolerant)
    try {
      const historicalQueriesResult = await getQueriesByBrand(brandId);
      if (historicalQueriesResult.result) {
        // Convert historical query format to current format (with safe property access)
        const convertedResults = historicalQueriesResult.result
          .filter((q: any) => q.status === 'completed' && q.aiResponses && q.aiResponses.length > 0)
          .map((query: any) => ({
            date: query.updatedAt || query.createdAt || new Date().toISOString(),
            processingSessionId: query.sessionId || 'legacy_session',
            processingSessionTimestamp: query.updatedAt || query.createdAt || new Date().toISOString(),
            query: query.userQuery || query.queryText || 'Unknown query',
            keyword: query.keyword || 'unknown',
            category: query.category || 'unknown',
            results: {
              // Convert legacy format to current format with safe access
              ...(query.aiResponses?.find((r: any) => r.provider === 'openai') && {
                chatgpt: {
                  response: query.aiResponses.find((r: any) => r.provider === 'openai')?.response || '',
                  timestamp: query.aiResponses.find((r: any) => r.provider === 'openai')?.timestamp || query.updatedAt,
                  responseTime: query.aiResponses.find((r: any) => r.provider === 'openai')?.responseTime
                }
              }),
              ...(query.aiResponses?.find((r: any) => r.provider === 'gemini') && {
                googleAI: {
                  aiOverview: query.aiResponses.find((r: any) => r.provider === 'gemini')?.response || '',
                  timestamp: query.aiResponses.find((r: any) => r.provider === 'gemini')?.timestamp || query.updatedAt,
                  responseTime: query.aiResponses.find((r: any) => r.provider === 'gemini')?.responseTime
                }
              })
            }
          }));
        
        allQueryResults.push(...convertedResults);
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch historical queries for latest session (fault-tolerant):', error);
      // Continue without historical data
    }
    
    if (allQueryResults.length === 0) {
      return { result: undefined };
    }
    
    // Group queries by processing session and find the latest session
    const sessionGroups: { [sessionId: string]: any[] } = {};
    let latestSessionId = '';
    let latestSessionTimestamp = '';
    
    allQueryResults.forEach(query => {
      const sessionId = query.processingSessionId || 'unknown_session';
      const sessionTimestamp = query.processingSessionTimestamp || query.date || '';
      
      if (!sessionGroups[sessionId]) {
        sessionGroups[sessionId] = [];
      }
      sessionGroups[sessionId].push(query);
      
      // Track the latest session
      if (sessionTimestamp > latestSessionTimestamp) {
        latestSessionTimestamp = sessionTimestamp;
        latestSessionId = sessionId;
      }
    });
    
    // Get queries from the latest session only
    const latestSessionQueries = sessionGroups[latestSessionId] || [];
    
    if (latestSessionQueries.length === 0) {
      return { result: undefined };
    }
    
    console.log(`📊 Found latest session: ${latestSessionId} with ${latestSessionQueries.length} queries`);
    
    // Calculate analytics for the latest session only
    const sessionAnalytics = calculateCumulativeAnalytics(
      userId,
      brandId,
      brandName,
      brandDomain,
      latestSessionId,
      latestSessionTimestamp,
      latestSessionQueries
    );
    
    console.log('✅ Latest session analytics calculated:', {
      sessionId: latestSessionId,
      totalQueries: latestSessionQueries.length,
      totalBrandMentions: sessionAnalytics.totalBrandMentions,
      topProvider: sessionAnalytics.insights.topPerformingProvider
    });
    
    return { result: sessionAnalytics };
    
  } catch (error) {
    console.error('❌ Error calculating latest session analytics from brand document:', error);
    return { error };
  }
}

// Calculate lifetime analytics across ALL historical queries for a brand
export async function calculateLifetimeBrandAnalytics(
  brandId: string
): Promise<{ result?: LifetimeBrandAnalytics; error?: any }> {
  try {
    console.log('🔄 Calculating lifetime analytics for brand:', brandId);
    
    // Get brand information
    let brand = await getBrandInfo(brandId);
    if (!brand) {
      return { error: 'Brand not found' };
    }
    
    // If the brand document has storage references, retrieve full data from Cloud Storage
    if ((brand as any).storageReferences?.queryProcessingResults) {
      console.log('📥 Brand has Cloud Storage references, retrieving full query results for analytics...');
      
      let retryCount = 0;
      const maxRetries = 3;
      
      while (retryCount < maxRetries) {
        try {
          const { document: fullBrandData } = await retrieveDocumentWithLargeData(
            'v8userbrands', 
            brandId, 
            ['queryProcessingResults']
          );
          
          if (fullBrandData?.queryProcessingResults) {
            brand.queryProcessingResults = fullBrandData.queryProcessingResults;
            console.log(`✅ Retrieved ${fullBrandData.queryProcessingResults.length} query results from Cloud Storage for analytics (attempt ${retryCount + 1})`);
            break; // Success, exit retry loop
          } else {
            console.warn(`⚠️ No query results found in Cloud Storage (attempt ${retryCount + 1})`);
          }
        } catch (storageError) {
          retryCount++;
          console.warn(`⚠️ Failed to retrieve query results from Cloud Storage (attempt ${retryCount}/${maxRetries}):`, storageError);
          
          if (retryCount < maxRetries) {
            // Wait before retrying (exponential backoff)
            const delay = Math.pow(2, retryCount) * 1000; // 2s, 4s, 8s
            console.log(`🔄 Retrying Cloud Storage retrieval in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(`❌ All ${maxRetries} Cloud Storage retrieval attempts failed. Continuing with truncated Firestore data.`);
            console.error('❌ This may cause analytics to be limited to ~50 queries instead of full dataset');
            
            // Log diagnostic information
            console.log('🔍 Diagnostic info:', {
              brandId,
              fireBrandQueryCount: brand.queryProcessingResults?.length || 0,
              hasStorageRefs: !!(brand as any).storageReferences?.queryProcessingResults,
              storageRefPath: (brand as any).storageReferences?.queryProcessingResults?.path || 'undefined'
            });
          }
        }
      }
    } else {
      console.log('ℹ️ No Cloud Storage references found, using Firestore data only');
      console.log('🔍 Query count from Firestore:', brand.queryProcessingResults?.length || 0);
    }
    
    const brandName = brand.companyName;
    const brandDomain = brand.domain;
    const userId = brand.userId;
    
    // Collect all historical query results from multiple sources
    const allQueryResults: any[] = [];
    let totalProcessingSessions = 0;
    const processingSessions = new Set<string>();
    
    // Store original Firestore query count for diagnostics
    const originalFirestoreQueryCount = brand.queryProcessingResults?.length || 0;
    (brand as any)._originalFirestoreQueryCount = originalFirestoreQueryCount;
    
    // 1. Get current session results from brand document
    if (brand.queryProcessingResults && brand.queryProcessingResults.length > 0) {
      allQueryResults.push(...brand.queryProcessingResults);
      brand.queryProcessingResults.forEach(result => {
        if (result.processingSessionId) {
          processingSessions.add(result.processingSessionId);
        }
      });
    }
    
    // 2. Try to get historical results from v8userqueries collection (fault-tolerant)
    console.log('🔍 Attempting to retrieve historical queries from v8userqueries collection...');
    try {
      const historicalQueriesResult = await getQueriesByBrand(brandId);
      if (historicalQueriesResult.result && historicalQueriesResult.result.length > 0) {
        console.log(`📚 Found ${historicalQueriesResult.result.length} historical queries in v8userqueries collection`);
        
        // Log the status breakdown for diagnostic purposes
        const statusCounts = historicalQueriesResult.result.reduce((acc: Record<string, number>, q: any) => {
          const status = q.status || 'unknown';
          acc[status] = (acc[status] || 0) + 1;
          return acc;
        }, {});
        console.log('📊 Historical query status breakdown:', statusCounts);
        // Convert historical query format to current format (fault-tolerant)
        const convertedResults = historicalQueriesResult.result
          .filter(q => q.status === 'completed' && q.aiResponses && q.aiResponses.length > 0)
          .map(query => {
            const result: any = {
              date: query.processedAt ? query.processedAt.toDate?.()?.toISOString() || query.processedAt : query.createdAt.toDate?.()?.toISOString() || query.createdAt,
              processingSessionId: `legacy_${query.id}`,
              processingSessionTimestamp: query.createdAt.toDate?.()?.toISOString() || query.createdAt,
              query: query.originalQuery,
              keyword: query.keyword,
              category: query.category,
              results: {}
            };
            
            // Convert AI responses to current format
            query.aiResponses.forEach(response => {
              const provider = response.provider.toLowerCase();
              if (provider.includes('openai') || provider.includes('chatgpt')) {
                result.results.chatgpt = {
                  response: response.response || '',
                  error: response.error,
                  timestamp: response.timestamp || result.date,
                  responseTime: response.responseTime
                };
              } else if (provider.includes('gemini') || provider.includes('google')) {
                result.results.googleAI = {
                  response: response.response || '',
                  error: response.error,
                  timestamp: response.timestamp || result.date,
                  responseTime: response.responseTime
                };
              } else if (provider.includes('perplexity')) {
                result.results.perplexity = {
                  response: response.response || '',
                  error: response.error,
                  timestamp: response.timestamp || result.date,
                  responseTime: response.responseTime
                };
              }
            });
            
            processingSessions.add(result.processingSessionId);
            return result;
          });
        
        allQueryResults.push(...convertedResults);
        console.log(`✅ Successfully converted ${convertedResults.length} historical queries to current format`);
      } else {
        console.log('ℹ️ No historical queries found in v8userqueries collection');
      }
    } catch (error) {
      console.warn('⚠️ Could not fetch historical queries (fault-tolerant):', error);
      // Continue without historical data
    }
    
    totalProcessingSessions = processingSessions.size;
    
    console.log(`📊 Analytics data collection summary:`, {
      totalQueries: allQueryResults.length,
      totalSessions: totalProcessingSessions,
      brandDocumentQueries: brand.queryProcessingResults?.length || 0,
      historicalQueries: allQueryResults.length - (brand.queryProcessingResults?.length || 0),
      brandId,
      brandName
    });
    
    // Additional diagnostic: Log query source breakdown
    const querySourceBreakdown = allQueryResults.reduce((acc, q) => {
      const isLegacy = q.processingSessionId?.startsWith('legacy_');
      acc[isLegacy ? 'historical' : 'current'] = (acc[isLegacy ? 'historical' : 'current'] || 0) + 1;
      return acc;
    }, {});
    console.log('🔍 Query source breakdown:', querySourceBreakdown);
    
    // Analytics debug functionality removed - no longer needed
    // const shouldRunDiagnostics = typeof window !== 'undefined' && 
    //   (localStorage.getItem(`analyticsDebug_${brandId}`) === 'true' || allQueryResults.length <= 50);
    
    // if (shouldRunDiagnostics) {
    //   try {
    //     const { diagnoseAnalyticsIssues, logAnalyticsDiagnostic } = await import('@/utils/analyticsDebug');
    //     const diagnostic = diagnoseAnalyticsIssues(
    //       brandId,
    //       allQueryResults,
    //       !!(brand as any).storageReferences?.queryProcessingResults,
    //       brand.queryProcessingResults && brand.queryProcessingResults.length > (brand as any)._originalFirestoreQueryCount || 0,
    //       undefined // We'd need to pass storage errors from the retry logic above
    //     );
    //     logAnalyticsDiagnostic(diagnostic);
    //   } catch (debugError) {
    //     console.warn('⚠️ Could not run analytics diagnostics:', debugError);
    //   }
    // }
    
    if (allQueryResults.length === 0) {
      // Return empty analytics if no queries found
      return {
        result: {
          userId,
          brandId,
          brandName,
          brandDomain,
          totalQueriesProcessed: 0,
          totalProcessingSessions: 0,
          totalBrandMentions: 0,
          brandVisibilityScore: 0,
          totalCitations: 0,
          totalDomainCitations: 0,
          allCitations: [], // Add required field
          providerStats: {
            chatgpt: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
            google: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 },
            perplexity: { queriesProcessed: 0, brandMentions: 0, citations: 0, domainCitations: 0 }
          },
          insights: {
            topPerformingProvider: 'none',
            topProviders: [],
            averageBrandMentionsPerQuery: 0,
            averageCitationsPerQuery: 0
          },
          calculatedAt: serverTimestamp()
        }
      };
    }
    
    // Use existing analytics calculation logic but for lifetime data
    const sessionAnalytics = calculateCumulativeAnalytics(
      userId,
      brandId,
      brandName,
      brandDomain,
      'lifetime_analytics',
      new Date().toISOString(),
      allQueryResults
    );
    
    // Find first and last query dates
    const queryDates = allQueryResults
      .map(q => new Date(q.date))
      .filter(date => !isNaN(date.getTime()))
      .sort((a, b) => a.getTime() - b.getTime());
    
    const firstQueryProcessed = queryDates.length > 0 ? queryDates[0].toISOString() : undefined;
    const lastQueryProcessed = queryDates.length > 0 ? queryDates[queryDates.length - 1].toISOString() : undefined;
    
    // Helper functions for citation extraction
    const extractDomainFromUrl = (url: string): string | undefined => {
      try {
        const urlObj = new URL(url);
        return urlObj.hostname.replace(/^www\./, '');
      } catch (e) {
        console.error('Invalid URL for domain extraction:', url, e);
        return undefined;
      }
    };
    
    const checkBrandMention = (text: string, url: string, brandName: string, brandDomain?: string): boolean => {
      if (!brandName) return false;
      const lowerText = text.toLowerCase();
      const lowerBrandName = brandName.toLowerCase();
      return lowerText.includes(lowerBrandName);
    };
    
    const checkDomainCitation = (url: string, brandDomain?: string): boolean => {
      if (!brandDomain) return false;
      const lowerUrl = url.toLowerCase();
      const lowerDomain = brandDomain.toLowerCase();
      
      // First check for exact match "https://www." + domain + "/"
      const httpsWwwDomain = `https://www.${lowerDomain}/`;
      if (lowerUrl.startsWith(httpsWwwDomain)) {
        return true;
      }
      
      // If first condition fails, check for exact match "https://" + domain + "/" (without www)
      const httpsDomain = `https://${lowerDomain}/`;
      if (lowerUrl.startsWith(httpsDomain)) {
        return true;
      }
      
      return false;
    };
    
    // Extract all individual citations from historical queries
    console.log('🔍 Extracting individual citations from all historical queries...');
    const allCitations: LifetimeCitation[] = [];
    let citationId = 1;
    
    allQueryResults.forEach(query => {
      const queryTimestamp = query.date || new Date().toISOString();
      
      // Extract ChatGPT citations
      if (query.results?.chatgpt?.response) {
        try {
          const { extractChatGPTCitations } = require('@/components/features/ChatGPTResponseRenderer');
          const chatgptCitations = extractChatGPTCitations(query.results.chatgpt.response);
          
          chatgptCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-chatgpt-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'ChatGPT',
              provider: 'chatgpt',
              query: query.query,
              queryId: query.id || '',
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: 'text_extraction',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting ChatGPT citations:', error);
        }
      }
      
      // Extract Google AI citations
      if (query.results?.googleAI?.aiOverview) {
        try {
          const { extractGoogleAIOverviewCitations } = require('@/components/features/GoogleAIOverviewRenderer');
          const googleCitations = extractGoogleAIOverviewCitations(query.results.googleAI.aiOverview, query.results.googleAI);
          
          googleCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-google-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'Google AI Overview',
              provider: 'googleAI',
              query: query.query,
              queryId: query.id || '',
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: 'ai_overview',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting Google AI citations:', error);
        }
      }
      
      // Extract Perplexity citations
      if (query.results?.perplexity?.response) {
        try {
          const { extractPerplexityCitations } = require('@/components/features/PerplexityResponseRenderer');
          const perplexityCitations = extractPerplexityCitations(query.results.perplexity.response, query.results.perplexity);
          
          perplexityCitations.forEach((citation: any) => {
            const domain = extractDomainFromUrl(citation.url);
            if (!domain) return; // Skip invalid domains only
            
            allCitations.push({
              id: `lifetime-perplexity-${citationId++}`,
              url: citation.url,
              text: citation.text,
              source: citation.source || 'Perplexity',
              provider: 'perplexity',
              query: query.query,
              queryId: query.id || '',
              brandName,
              domain,
              timestamp: queryTimestamp,
              type: citation.type || 'structured',
              isBrandMention: checkBrandMention(citation.text, citation.url, brandName, brandDomain),
              isDomainCitation: checkDomainCitation(citation.url, brandDomain),
              processingSessionId: query.processingSessionId || 'unknown'
            });
          });
        } catch (error) {
          console.warn('⚠️ Error extracting Perplexity citations:', error);
        }
      }
    });
    
    console.log(`✅ Extracted ${allCitations.length} individual citations from ${allQueryResults.length} historical queries`);
    
    // Convert to lifetime analytics format
    const lifetimeAnalytics: LifetimeBrandAnalytics = {
      userId,
      brandId,
      brandName,
      brandDomain,
      totalQueriesProcessed: allQueryResults.length,
      totalProcessingSessions,
      totalBrandMentions: sessionAnalytics.totalBrandMentions,
      brandVisibilityScore: sessionAnalytics.brandVisibilityScore,
      totalCitations: sessionAnalytics.totalCitations,
      totalDomainCitations: sessionAnalytics.totalDomainCitations,
      allCitations, // Add the extracted individual citations
      providerStats: sessionAnalytics.providerStats,
      insights: {
        topPerformingProvider: sessionAnalytics.insights.topPerformingProvider,
        topProviders: sessionAnalytics.insights.topProviders,
        averageBrandMentionsPerQuery: sessionAnalytics.insights.averageBrandMentionsPerQuery,
        averageCitationsPerQuery: sessionAnalytics.insights.averageCitationsPerQuery,
        firstQueryProcessed,
        lastQueryProcessed,
        providerRankingDetails: sessionAnalytics.insights.providerRankingDetails
      },
      calculatedAt: serverTimestamp()
    };
    
    console.log('✅ Lifetime analytics calculated:', {
      totalQueries: lifetimeAnalytics.totalQueriesProcessed,
      totalSessions: lifetimeAnalytics.totalProcessingSessions,
      totalBrandMentions: lifetimeAnalytics.totalBrandMentions,
      topProvider: lifetimeAnalytics.insights.topPerformingProvider
    });
    
    return { result: lifetimeAnalytics };
    
  } catch (error) {
    console.error('❌ Error calculating lifetime analytics:', error);
    return { error };
  }
}

// Save brand analytics to Firestore
export async function saveBrandAnalytics(analyticsData: BrandAnalyticsData): Promise<{ success: boolean; error?: any }> {
  try {
    const docRef = doc(collection(db, 'v8_user_brand_analytics'));
    await setDoc(docRef, analyticsData);
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving brand analytics:', error);
    return { success: false, error };
  }
}

// Save lifetime analytics to Firestore for historical tracking
export async function saveLifetimeAnalytics(analyticsData: LifetimeBrandAnalytics): Promise<{ success: boolean; error?: any }> {
  try {
    // Create a unique document ID based on brand and timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const documentId = `${analyticsData.brandId}_lifetime_${timestamp}`;
    
    // Create a copy for Firestore with potential data optimization
    const analyticsDataForFirestore: any = {
      ...analyticsData,
      createdAt: serverTimestamp(),
      documentType: 'lifetime_analytics',
      originalCitationCount: analyticsData.allCitations?.length || 0,
      dataTruncated: false,
      storedInCloudStorage: false
    };
    
    // Check if the data is still too large and needs Cloud Storage
    const { exceedsFirestoreLimit } = await import('@/firebase/storage/cloudStorage');
    
    if (exceedsFirestoreLimit(analyticsDataForFirestore)) {
      console.log('📦 Analytics data exceeds Firestore limits, storing in Cloud Storage...');
      
      // Store large data in Cloud Storage
      const { storeLargeData } = await import('@/firebase/storage/cloudStorage');
      const { storageRef, error: storageError } = await storeLargeData(
        analyticsData, // Store full data in Cloud Storage
        `lifetime-analytics/${analyticsData.brandId}`,
        'lifetime_analytics',
        {
          brandId: analyticsData.brandId,
          citationCount: analyticsData.allCitations?.length || 0
        }
      );
      
      if (storageError) {
        console.warn('⚠️ Failed to store analytics in Cloud Storage, truncating citations for Firestore');
        // Only truncate if Cloud Storage fails
        analyticsDataForFirestore.allCitations = analyticsData.allCitations?.slice(0, 100) || [];
        analyticsDataForFirestore.dataTruncated = true;
        analyticsDataForFirestore.truncationReason = 'cloud_storage_failed';
      } else {
        // Successfully stored in Cloud Storage - save only a reference and summary in Firestore
        if (storageRef?.storagePath) {
          analyticsDataForFirestore.storageRef = storageRef.storagePath;
        }
        analyticsDataForFirestore.allCitations = []; // Remove citations from Firestore document
        analyticsDataForFirestore.dataTruncated = false;
        analyticsDataForFirestore.storedInCloudStorage = true;
        console.log(`✅ Full analytics data with ${analyticsData.allCitations?.length || 0} citations stored in Cloud Storage`);
      }
    } else {
      // Data fits in Firestore, keep all citations
      analyticsDataForFirestore.dataTruncated = false;
      analyticsDataForFirestore.storedInCloudStorage = false;
      console.log(`✅ Analytics data with ${analyticsData.allCitations?.length || 0} citations stored directly in Firestore`);
    }
    
    // Remove undefined fields before saving to Firebase (deep clean)
    const cleanUndefinedFields = (obj: any): any => {
      if (obj === null || typeof obj !== 'object') return obj;
      
      if (Array.isArray(obj)) {
        return obj.map(cleanUndefinedFields);
      }
      
      const cleaned: any = {};
      for (const [key, value] of Object.entries(obj)) {
        if (value !== undefined) {
          cleaned[key] = cleanUndefinedFields(value);
        }
      }
      return cleaned;
    };

    const cleanedData = cleanUndefinedFields(analyticsDataForFirestore);

    const docRef = doc(db, 'v8_lifetime_brand_analytics', documentId);
    await setDoc(docRef, cleanedData);
    
    console.log('✅ Lifetime analytics saved to Firestore:', {
      documentId: docRef.id,
      citationCount: analyticsData.allCitations?.length || 0,
      dataTruncated: cleanedData.dataTruncated,
      usedCloudStorage: cleanedData.storedInCloudStorage,
      storageRef: cleanedData.storageRef
    });
    
    return { success: true };
  } catch (error) {
    console.error('❌ Error saving lifetime analytics:', error);
    
    // If it's a write stream exhaustion error, try saving with minimal data
    if ((error as any)?.code === 'resource-exhausted' || (error as any)?.message?.includes('Write stream exhausted')) {
      console.log('🔄 Retrying with minimal analytics data due to write stream exhaustion...');
      
      try {
        const minimalAnalytics = {
          userId: analyticsData.userId,
          brandId: analyticsData.brandId,
          brandName: analyticsData.brandName,
          brandDomain: analyticsData.brandDomain,
          totalQueriesProcessed: analyticsData.totalQueriesProcessed,
          totalBrandMentions: analyticsData.totalBrandMentions,
          brandVisibilityScore: analyticsData.brandVisibilityScore,
          totalCitations: analyticsData.totalCitations,
          totalDomainCitations: analyticsData.totalDomainCitations,
          totalProcessingSessions: analyticsData.totalProcessingSessions,
          providerStats: analyticsData.providerStats,
          insights: analyticsData.insights,
          calculatedAt: analyticsData.calculatedAt,
          // Exclude large arrays
          allCitations: [],
          createdAt: serverTimestamp(),
          documentType: 'lifetime_analytics',
          dataTruncated: true,
          storedInCloudStorage: false,
          originalCitationCount: analyticsData.allCitations?.length || 0,
          truncationReason: 'write_stream_exhausted'
        };
        
        const minimalTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const docRef = doc(db, 'v8_lifetime_brand_analytics', `${analyticsData.brandId}_lifetime_minimal_${minimalTimestamp}`);
        await setDoc(docRef, minimalAnalytics);
        
        console.log('✅ Minimal lifetime analytics saved after write stream exhaustion');
        return { success: true };
      } catch (retryError) {
        console.error('❌ Failed to save even minimal analytics:', retryError);
        return { success: false, error: retryError };
      }
    }
    
    return { success: false, error };
  }
}

// Get latest brand analytics for a specific brand
export async function getLatestBrandAnalytics(brandId: string): Promise<{ result?: BrandAnalyticsData; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      limit(1)
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return { result: undefined };
    }
    
    const doc = querySnapshot.docs[0];
    const analytics = { id: doc.id, ...doc.data() } as BrandAnalyticsData;
    
    return { result: analytics };
  } catch (error) {
    console.error('❌ Error fetching latest brand analytics:', error);
    return { error };
  }
}

// Get brand analytics history with trend analysis
export async function getBrandAnalyticsHistory(brandId: string): Promise<{ result?: BrandAnalyticsHistory; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('brandId', '==', brandId),
      orderBy('processingSessionTimestamp', 'desc'),
      limit(2) // Get latest and previous for trend calculation
    );
    
    const querySnapshot = await getDocs(q);
    
    if (querySnapshot.empty) {
      return { result: undefined };
    }
    
    const docs = querySnapshot.docs;
    const latestAnalytics = { id: docs[0].id, ...docs[0].data() } as BrandAnalyticsData;
    const previousAnalytics = docs.length > 1 ? { id: docs[1].id, ...docs[1].data() } as BrandAnalyticsData : undefined;
    
    // Calculate trends
    let trend = {
      brandMentionsChange: 0,
      citationsChange: 0,
      visibilityChange: 0
    };
    
    if (previousAnalytics) {
      trend = {
        brandMentionsChange: latestAnalytics.totalBrandMentions - previousAnalytics.totalBrandMentions,
        citationsChange: latestAnalytics.totalCitations - previousAnalytics.totalCitations,
        visibilityChange: latestAnalytics.brandVisibilityScore - previousAnalytics.brandVisibilityScore
      };
      
      // Update trend direction in latest analytics
      latestAnalytics.insights.brandVisibilityTrend = 
        trend.visibilityChange > 1 ? 'improving' : 
        trend.visibilityChange < -1 ? 'declining' : 'stable';
    }
    
    const history: BrandAnalyticsHistory = {
      brandId,
      totalSessions: querySnapshot.size,
      latestAnalytics,
      previousAnalytics,
      trend
    };
    
    return { result: history };
  } catch (error) {
    console.error('❌ Error fetching brand analytics history:', error);
    return { error };
  }
}

// Get all analytics for a user across all brands
export async function getUserBrandAnalytics(userId: string): Promise<{ result?: BrandAnalyticsData[]; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8_user_brand_analytics'),
      where('userId', '==', userId),
      orderBy('processingSessionTimestamp', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    
    const analytics: BrandAnalyticsData[] = [];
    querySnapshot.forEach((doc) => {
      analytics.push({
        id: doc.id,
        ...doc.data()
      } as BrandAnalyticsData);
    });
    
    return { result: analytics };
  } catch (error) {
    console.error('❌ Error fetching user brand analytics:', error);
    return { error };
  }
} 