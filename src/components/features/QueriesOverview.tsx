'use client'
import React, { useState, useEffect, useMemo } from 'react';
import { useBrandContext } from '@/context/BrandContext';
import Card from '@/components/shared/Card';
import { 
  Search, 
  Eye,
  Lightbulb,
  TrendingUp,
  ShoppingCart,
  Clock,
  ArrowRight,
  Activity,
  RefreshCw,
  X
} from 'lucide-react';
import ProcessQueriesButton from './ProcessQueriesButton';
import { UserBrand } from '@/firebase/firestore/getUserBrands';
import { extractChatGPTCitations } from './ChatGPTResponseRenderer';
import { extractGoogleAIOverviewCitations } from './GoogleAIOverviewRenderer';
import { extractPerplexityCitations } from './PerplexityResponseRenderer';
import { analyzeBrandMentions } from './BrandMentionCounter';

// Add LoadingDots component
const LoadingDots = () => (
  <span className="inline-flex items-center">
    <span className="animate-[loading_1.4s_ease-in-out_infinite] rounded-full h-1 w-1 mx-0.5 bg-white"></span>
    <span className="animate-[loading_1.4s_ease-in-out_0.2s_infinite] rounded-full h-1 w-1 mx-0.5 bg-white"></span>
    <span className="animate-[loading_1.4s_ease-in-out_0.4s_infinite] rounded-full h-1 w-1 mx-0.5 bg-white"></span>
  </span>
);

interface QueriesOverviewProps {
  variant?: 'full' | 'compact' | 'minimal';
  layout?: 'cards' | 'table'; // New prop for layout type
  maxQueries?: number;
  showProcessButton?: boolean;
  showSearch?: boolean;
  showEyeIcons?: boolean;
  showCategoryFilter?: boolean; // New prop
  brandOverride?: UserBrand; // Allow overriding the selected brand
  className?: string;
  onViewAll?: () => void; // Callback for "View All" action
  onQueryClick?: (query: any, result: any) => void; // Callback for individual query clicks
}

export default function QueriesOverview({ 
  variant = 'compact',
  layout = 'cards',
  maxQueries = 5,
  showProcessButton = true,
  showSearch = false,
  showEyeIcons = true,
  showCategoryFilter = true,
  brandOverride,
  className = '',
  onViewAll,
  onQueryClick
}: QueriesOverviewProps): React.ReactElement {
  const { selectedBrand, refetchBrands } = useBrandContext();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [liveResults, setLiveResults] = useState<any[]>([]);
  const [countdown, setCountdown] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [processingQueries, setProcessingQueries] = useState<Set<string>>(new Set()); // Track which queries are being processed
  const [isProcessingActive, setIsProcessingActive] = useState(false); // Track if any processing is happening
  // const processButtonRef = React.useRef<any>(null); // Removed as per edit hint

  // Use brand override if provided, otherwise use selected brand
  const brand = brandOverride || selectedBrand;
  
  // Safely get queries and results (with fallbacks)
  const queries = brand?.queries || [];
  const savedResults = brand?.queryProcessingResults || [];
  
  // Combine saved results with live processing results (memoized to prevent infinite re-renders)
  const queryResults = useMemo(() => {
    return [...savedResults, ...liveResults];
  }, [savedResults, liveResults]);
  
  // Create stable values for the countdown effect
  const resultsCount = useMemo(() => queryResults.length, [queryResults.length]);
  const latestResultTime = useMemo(() => {
    if (queryResults.length === 0) return 0;
    return Math.max(...queryResults.map(r => r.date ? new Date(r.date).getTime() : 0));
  }, [queryResults]);

  // Calculate next processing date and setup countdown
  useEffect(() => {
    // Early return if no brand
    if (!brand) {
      setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      return;
    }

    // Reset countdown if no results
    if (resultsCount === 0) {
      setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      return;
    }
    
    // Find the most recent result
    let lastProcessedDate: string | null = null;
    for (const result of queryResults) {
      if (result.date && (!lastProcessedDate || new Date(result.date) > new Date(lastProcessedDate))) {
        lastProcessedDate = result.date;
      }
    }
    
    if (!lastProcessedDate) {
      setCountdown({ days: 0, hours: 0, minutes: 0, seconds: 0 });
      return;
    }
    
    const nextProcessingDate = new Date(lastProcessedDate);
    nextProcessingDate.setDate(nextProcessingDate.getDate() + 7);
    
    const updateCountdown = () => {
      const now = new Date().getTime();
      const targetTime = nextProcessingDate.getTime();
      const difference = targetTime - now;
      
      if (difference > 0) {
        const days = Math.floor(difference / (1000 * 60 * 60 * 24));
        const hours = Math.floor((difference % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((difference % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((difference % (1000 * 60)) / 1000);
        
        setCountdown(prev => {
          // Only update if values actually changed to prevent unnecessary re-renders
          if (prev.days !== days || prev.hours !== hours || prev.minutes !== minutes || prev.seconds !== seconds) {
            return { days, hours, minutes, seconds };
          }
          return prev;
        });
      } else {
        setCountdown(prev => {
          // Only update if not already zero
          if (prev.days !== 0 || prev.hours !== 0 || prev.minutes !== 0 || prev.seconds !== 0) {
            return { days: 0, hours: 0, minutes: 0, seconds: 0 };
          }
          return prev;
        });
      }
    };
    
    // Update immediately
    updateCountdown();
    
    // Update every second
    const interval = setInterval(updateCountdown, 1000);
    
    return () => clearInterval(interval);
  }, [brand?.id, resultsCount, latestResultTime]);

  const findQueryResult = (query: string) => {
    return queryResults.find(result => result.query === query);
  };

  // Compute if we should auto-start processing
  const queriesWithoutResults = queries.filter(q => !findQueryResult(q.query));
  const shouldAutoStart = queriesWithoutResults.length >= 4 && !isProcessingActive;

  // Automatically trigger Process Queries if more than 5 queries have no results
  // useEffect(() => {
  //   if (!brand || !showProcessButton) return;
  //   const queriesWithoutResults = queries.filter(q => !findQueryResult(q.query));
  //   if (queriesWithoutResults.length >= 1 && processButtonRef.current && !isProcessingActive) {
  //     // Programmatically trigger the button's click or handler
  //     if (typeof processButtonRef.current.click === 'function') {
  //       processButtonRef.current.click();
  //     } else if (typeof processButtonRef.current === 'function') {
  //       processButtonRef.current();
  //     }
  //   }
  // }, [brand, queries, queryResults, showProcessButton, isProcessingActive]); // Removed as per edit hint

  // Filter queries based on search and category
  const filteredQueries = queries.filter(query => {
    const matchesSearch = query.query.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         query.keyword.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || query.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  // Limit queries based on variant and maxQueries prop
  const displayQueries = variant === 'full' ? filteredQueries : filteredQueries.slice(0, maxQueries);

  // Get unique categories for filter
  const categories = ['all', ...new Set(queries.map(q => q.category))];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Awareness': return <Eye className="h-3 w-3" />;
      case 'Interest': return <Lightbulb className="h-3 w-3" />;
      case 'Consideration': return <TrendingUp className="h-3 w-3" />;
      case 'Purchase': return <ShoppingCart className="h-3 w-3" />;
      default: return <Search className="h-3 w-3" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Awareness': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Interest': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'Consideration': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Purchase': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // Helper function to get query status
  const getQueryStatus = (query: any) => {
    const queryResult = findQueryResult(query.query);
    
    // Check if this query is currently being processed
    if (processingQueries.has(query.query)) {
      return {
        status: 'Processing',
        color: 'bg-blue-500 text-white',
        description: 'Query is being processed...',
        showLoader: true // Add this flag
      };
    }
    
    // Check if query has been processed
    if (queryResult) {
      // Calculate if it was processed within the last 7 days
      const processedDate = new Date(queryResult.date);
      const now = new Date();
      const daysSinceProcessed = Math.floor((now.getTime() - processedDate.getTime()) / (1000 * 60 * 60 * 24));
      
      if (daysSinceProcessed <= 7) {
        return {
          status: 'Processed',
          color: 'bg-green-500 text-white',
          description: `Processed ${daysSinceProcessed} day${daysSinceProcessed !== 1 ? 's' : ''} ago`,
          showLoader: false
        };
      } else {
        return {
          status: 'Due for Processing',
          color: 'bg-amber-500 text-white',
          description: `Processed ${daysSinceProcessed} days ago (due for reprocessing)`,
          showLoader: false
        };
      }
    }
    
    // Query has not been processed
    return {
      status: 'Unprocessed',
      color: 'bg-gray-500 text-white',
      description: 'Query has not been processed yet',
      showLoader: false
    };
  };

  // Helper function to analyze brand mentions for a specific query result
  const getBrandAnalysisForQuery = (queryResult: any) => {
    if (!queryResult || !brand) return null;

    const brandName = brand.companyName || '';
    const brandDomain = brand.domain || '';

    // Extract citations for each provider
    const chatgptCitations = queryResult.results?.chatgpt ? 
      extractChatGPTCitations(queryResult.results.chatgpt.response || '') : [];
    const googleCitations = queryResult.results?.googleAI ? 
      extractGoogleAIOverviewCitations(queryResult.results.googleAI.aiOverview || '', queryResult.results.googleAI) : [];
    const perplexityCitations = queryResult.results?.perplexity ? 
      extractPerplexityCitations(queryResult.results.perplexity.response || '', queryResult.results.perplexity) : [];

    // Analyze brand mentions
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
    }, brand?.competitors || []);

    return {
      analysis,
      citationCounts: {
        chatgpt: chatgptCitations.length,
        google: googleCitations.length,
        perplexity: perplexityCitations.length,
        total: chatgptCitations.length + googleCitations.length + perplexityCitations.length
      }
    };
  };

  // If no brand, show empty state
  if (!brand) {
    return (
      <Card className={className}>
        <div className="text-center py-8">
          <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <h3 className="text-sm font-medium text-foreground mb-1">No Brand Selected</h3>
          <p className="text-xs text-muted-foreground">
            Select a brand to view queries
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className={className}>
      {/* Header */}
      <div className="p-4 border-b border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Activity className="h-5 w-5 text-[#000C60]" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                {variant === 'minimal' ? 'Queries' : 'Queries Overview'}
              </h3>
              {variant !== 'minimal' && (
                <p className="text-xs text-muted-foreground">
                  {brand.companyName}
                  {queryResults.length > 0 && (
                    <span className="ml-2">
                      • Total: {queryResults.length} Queries Processed
                      <br />
                      {(() => {
                        const sortedResults = queryResults.sort((a, b) => 
                          new Date(b.date).getTime() - new Date(a.date).getTime()
                        );
                        const lastProcessedDate = sortedResults[0]?.date;
                        return lastProcessedDate ? 
                          `Last Processed: ${new Date(lastProcessedDate).toLocaleDateString()}` : 
                          '';
                      })()}
                    </span>
                  )}
                </p>
              )}
            </div>
          </div>
          
          <div className="flex items-center space-x-3">
            {queryResults.length > 0 && variant !== 'minimal' && (
              <span className="text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded-md">
                <Clock className="h-3 w-3 inline mr-1" />
                Scheduled: {countdown.days}d {countdown.hours}h {countdown.minutes}m
              </span>
            )}
            
            {showProcessButton && (
              <ProcessQueriesButton 
                brandId={brand.id}
                variant="ghost"
                size="sm"
                autoStart={shouldAutoStart}
                onStart={() => {
                  // Set all queries as potentially processing when processing starts
                  setIsProcessingActive(true);
                  const allQueryNames = new Set(queries.map(q => q.query));
                  setProcessingQueries(allQueryNames);
                }}
                onQueryStart={(queryName) => {
                  // Mark this specific query as processing
                  setProcessingQueries(prev => new Set([...prev, queryName]));
                }}
                onProgress={(results) => {
                  setLiveResults(results);
                  // Remove completed queries from processing set
                  const completedQueries = new Set(results.map(r => r.query));
                  const allQueryNames = new Set(queries.map(q => q.query));
                  const stillProcessing = new Set([...allQueryNames].filter(q => !completedQueries.has(q)));
                  setProcessingQueries(stillProcessing);
                }}
                onComplete={async (result) => {
                  // Clear processing states immediately
                  setIsProcessingActive(false);
                  setProcessingQueries(new Set());
                  setLiveResults([]);
                  
                  // Refresh brands to get updated data
                  await refetchBrands();
                }}
              />
            )}
            
            {onViewAll && displayQueries.length > 0 && (
              <button
                onClick={onViewAll}
                className="flex items-center space-x-1 text-xs text-[#000C60] hover:text-[#000C60]/80 transition-colors"
              >
                <span>View All</span>
                <ArrowRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Search Bar and Filters */}
        {(showSearch || (showCategoryFilter && categories.length > 2)) && (
          <div className="mt-3 space-y-2">
            {showSearch && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search queries..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-[#000C60]/20 focus:border-[#000C60]"
                />
              </div>
            )}
            
            {showCategoryFilter && categories.length > 2 && (
              <div className="flex flex-wrap gap-1">
                {categories.map((category) => (
                  <button
                    key={category}
                    onClick={() => setSelectedCategory(category)}
                    className={`px-2 py-1 text-xs rounded-md transition-colors ${
                      selectedCategory === category
                        ? 'bg-[#000C60] text-white'
                        : 'bg-muted text-muted-foreground hover:bg-muted/80'
                    }`}
                  >
                    {category === 'all' ? 'All' : category}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="p-4">
        {displayQueries.length > 0 ? (
          layout === 'table' ? (
            /* Table Layout */
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-muted/50 border-b border-border">
                  <tr>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Queries</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Topic</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Intent</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Brand Mentions</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Citations</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Competitors Mentions</th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {displayQueries.map((query, index) => {
                    const queryResult = findQueryResult(query.query);
                    const hasResults = !!queryResult;
                    const brandAnalysis = hasResults ? getBrandAnalysisForQuery(queryResult) : null;
                    const statusInfo = getQueryStatus(query);
                    
                    return (
                      <tr 
                        key={index} 
                        className="hover:bg-blue-50 hover:shadow-sm transition-all duration-200 cursor-pointer group"
                        onClick={() => {
                          if (hasResults && onQueryClick) {
                            onQueryClick(query, queryResult);
                          }
                        }}
                      >
                        <td className="px-4 py-4">
                          <div className="font-medium text-foreground max-w-md text-left">
                            {query.query.length > 60 ? (
                              <span title={query.query}>
                                {query.query.substring(0, 60)}...
                              </span>
                            ) : (
                              query.query
                            )}
                            {hasResults && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Processed on {new Date(queryResult.date).toLocaleDateString()}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span 
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}
                            title={statusInfo.description}
                          >
                            {statusInfo.status}
                            {statusInfo.showLoader && <LoadingDots />}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <span className="text-muted-foreground">{query.keyword}</span>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className={`inline-flex items-center space-x-1 px-3 py-1.5 rounded-full text-xs font-medium ${getCategoryColor(query.category)}`}>
                            {getCategoryIcon(query.category)}
                            <span>{query.category}</span>
                          </div>
                        </td>
                        {/* Brand Mentions Column */}
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-center space-y-2">
                            {hasResults && brandAnalysis ? (
                              <>
                                {/* Total Brand Mentions */}
                                <span className="text-lg font-bold text-foreground">
                                  {brandAnalysis.analysis.totals.totalBrandMentions}
                                </span>
                                
                                {/* Provider Icons for Brand Mentions */}
                                <div className="flex items-center justify-center space-x-2">
                                  {/* ChatGPT */}
                                  {brandAnalysis.analysis.results.chatgpt?.brandMentioned ? (
                                    <div title="ChatGPT - Brand Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-green-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Google AI Overview */}
                                  {brandAnalysis.analysis.results.google?.brandMentioned ? (
                                    <div title="Google AI Overview - Brand Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-4 h-4" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                        <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657
	C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                                        <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                                        <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Perplexity */}
                                  {brandAnalysis.analysis.results.perplexity?.brandMentioned ? (
                                    <div title="Perplexity - Brand Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-green-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Cross if no brand mentions */}
                                  {brandAnalysis.analysis.totals.totalBrandMentions === 0 && (
                                    <div title="No Brand Mentions" className="flex-shrink-0">
                                      <X className="w-4 h-4 text-red-500" />
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </div>
                        </td>

                        {/* Citations Column */}
                        <td className="px-4 py-4 text-center">
                          {hasResults && brandAnalysis ? (
                            <span className="text-sm font-medium text-foreground">
                              {brandAnalysis.analysis.totals.totalDomainCitations} / {brandAnalysis.citationCounts.total}
                            </span>
                          ) : (
                            <span className="text-muted-foreground text-sm">-</span>
                          )}
                        </td>

                        {/* Competitors Mentioned Column */}
                        <td className="px-4 py-4">
                          <div className="flex flex-col items-center space-y-2">
                            {hasResults && brandAnalysis ? (
                              <>
                                {/* Total Competitor Mentions */}
                                <span className="text-lg font-bold text-foreground">
                                  {brandAnalysis.analysis.totals.totalCompetitorMentions}
                                </span>
                                
                                {/* Provider Icons for Competitor Mentions */}
                                <div className="flex items-center justify-center space-x-2">
                                  {/* ChatGPT */}
                                  {brandAnalysis.analysis.results.chatgpt?.competitorMentioned ? (
                                    <div title="ChatGPT - Competitor Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-red-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Google AI Overview */}
                                  {brandAnalysis.analysis.results.google?.competitorMentioned ? (
                                    <div title="Google AI Overview - Competitor Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-4 h-4 text-red-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                        <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657
	C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                                        <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                                        <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Perplexity */}
                                  {brandAnalysis.analysis.results.perplexity?.competitorMentioned ? (
                                    <div title="Perplexity - Competitor Mentioned" className="flex-shrink-0">
                                      <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-red-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
                                      </svg>
                                    </div>
                                  ) : null}

                                  {/* Cross if no competitor mentions */}
                                  {brandAnalysis.analysis.totals.totalCompetitorMentions === 0 && (
                                    <div title="No Competitor Mentions" className="flex-shrink-0">
                                      <X className="w-4 h-4 text-red-500" />
                                    </div>
                                  )}
                                </div>
                              </>
                            ) : (
                              <span className="text-muted-foreground text-sm">-</span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center">
                            {showEyeIcons && hasResults && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation(); // Prevent row click when button is clicked
                                  onQueryClick && onQueryClick(query, queryResult);
                                }}
                                className="px-3 py-1.5 text-xs font-medium text-[#000C60] bg-[#000C60]/10 hover:bg-[#000C60]/20 rounded-lg transition-colors duration-200 group-hover:bg-[#000C60] group-hover:text-white"
                                title="View detailed AI responses"
                              >
                                More Details
                              </button>
                            )}
                            {!hasResults && (
                              <span className="text-xs text-muted-foreground">No data</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* Cards Layout */
            <div className="space-y-3">
              {displayQueries.map((query, index) => {
                const queryResult = findQueryResult(query.query);
                const hasResults = !!queryResult;
                const statusInfo = getQueryStatus(query);
                
                return (
                  <div 
                    key={index} 
                    className={`flex items-center justify-between p-3 rounded-lg border border-border hover:bg-blue-50 hover:shadow-sm transition-all duration-200 cursor-pointer group ${
                      hasResults && onQueryClick ? 'cursor-pointer' : ''
                    }`}
                    onClick={() => {
                      if (hasResults && onQueryClick) {
                        onQueryClick(query, queryResult);
                      }
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${getCategoryColor(query.category)}`}>
                          {getCategoryIcon(query.category)}
                          <span>{query.category}</span>
                        </div>
                        <span className="text-xs text-muted-foreground">{query.keyword}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusInfo.color}`}>
                          {statusInfo.status}
                          {statusInfo.showLoader && <LoadingDots />}
                        </span>
                      </div>
                      <p className="text-sm text-foreground truncate" title={query.query}>
                        {query.query}
                      </p>
                      {hasResults && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Processed on {new Date(queryResult.date).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    
                    <div className="flex items-center space-x-2">
                      {/* {showEyeIcons && hasResults && (
                        <div className="flex items-center space-x-1">
                          {queryResult.results.chatgpt && (
                            <div className="w-2 h-2 bg-green-500 rounded-full" title="ChatGPT response available" />
                          )}
                          {queryResult.results.gemini && (
                            <div className="w-2 h-2 bg-blue-500 rounded-full" title="Gemini response available" />
                          )}
                          {queryResult.results.perplexity && (
                            <div className="w-2 h-2 bg-purple-500 rounded-full" title="Perplexity response available" />
                          )}
                        </div>
                      )} */}
                      {/* {showEyeIcons && hasResults && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation(); // Prevent row click when button is clicked
                            onQueryClick && onQueryClick(query, queryResult);
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-[#000C60] bg-[#000C60]/10 hover:bg-[#000C60]/20 rounded-md transition-colors duration-200 group-hover:bg-[#000C60] group-hover:text-white"
                          title="View detailed AI responses"
                        >
                          More Details
                        </button>
                      )} */}
                      {!hasResults && (
                        <span className="text-xs text-muted-foreground">No data</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : queries.length > 0 ? (
          <div className="text-center py-6">
            <Search className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">No matches found</p>
            <p className="text-xs text-muted-foreground">
              Try adjusting your search query
            </p>
          </div>
        ) : (
          <div className="text-center py-6">
            <RefreshCw className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground mb-1">No Queries Available</p>
            <p className="text-xs text-muted-foreground">
              Generate queries for {brand.companyName} to get started
            </p>
          </div>
        )}
      </div>
    </Card>
  );
} 