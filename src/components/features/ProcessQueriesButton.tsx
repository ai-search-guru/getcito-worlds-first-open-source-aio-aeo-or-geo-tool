'use client'
import React, { useState, useRef, useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';
import { RefreshCw, Zap, AlertCircle, CheckCircle, RotateCcw, StopCircle, CreditCard } from 'lucide-react';
import { updateBrandWithQueryResults } from '@/firebase/firestore/getUserBrands';
import { saveDetailedQueryResults } from '@/firebase/firestore/detailedQueryResults';
import { calculateCumulativeAnalytics, saveBrandAnalytics, calculateLifetimeBrandAnalytics, saveLifetimeAnalytics } from '@/firebase/firestore/brandAnalytics';
import { calculateCumulativeCompetitorAnalytics } from '@/utils/competitor-analytics';
import { saveCompetitorAnalytics } from '@/firebase/firestore/competitorAnalytics';
import { Competitor } from '@/lib/competitor-matching';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

interface ProcessQueriesButtonProps {
  brandId?: string;
  onComplete?: (result: any) => void;
  onProgress?: (results: any[]) => void; // New callback for real-time updates
  onStart?: () => void; // New callback for when processing starts
  onQueryStart?: (query: string) => void; // New callback for when individual query processing starts
  className?: string;
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  autoStart?: boolean; // NEW PROP
}

export default function ProcessQueriesButton({ 
  brandId, 
  onComplete,
  onProgress,
  onStart,
  onQueryStart,
  className = '',
  variant = 'primary',
  size = 'md',
  autoStart = false // NEW PROP
}: ProcessQueriesButtonProps): React.ReactElement {
  const { user, userProfile, refreshUserProfile } = useAuthContext();
  const { selectedBrand, brands, refetchBrands } = useBrandContext();
  const { showSuccess, showError, showWarning, showInfo } = useToast();
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<'idle' | 'processing' | 'success' | 'error' | 'cancelled'>('idle');
  const [message, setMessage] = useState('');
  const [processedResults, setProcessedResults] = useState<any[]>([]);
  
  // Add ref to track cancellation
  const cancelledRef = useRef(false);

  // Auto-trigger processing if autoStart becomes true
  const [autoStarted, setAutoStarted] = useState(false);
  useEffect(() => {
    if (autoStart && !autoStarted && !processing) {
      setAutoStarted(true);
      handleProcessQueries();
    } else if (!autoStart && autoStarted) {
      setAutoStarted(false);
    }
  }, [autoStart, autoStarted, processing]);

  const handleProcessQueries = async () => {
    if (!user?.uid) {
      setStatus('error');
      setMessage('Please sign in to process queries');
      return;
    }

    // Check user credits (10 credits per query) - Skip if autoStart is true
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    
    if (!targetBrand) {
      setStatus('error');
      setMessage('No brand selected');
      return;
    }

    const brandName = targetBrand.companyName;
    const queries = targetBrand.queries || [];

    if (queries.length === 0) {
      setStatus('error');
      setMessage('No queries to process');
      return;
    }

    // Only check credits if NOT auto-starting
    if (!autoStart) {
      // Check if user has enough credits (10 per query)
      const requiredCredits = queries.length * 10;
      const availableCredits = userProfile?.credits || 0;
      
      if (availableCredits < requiredCredits) {
        setStatus('error');
        setMessage(`Insufficient credits. Need ${requiredCredits}, have ${availableCredits}`);
        
        // Show user-friendly notification
        showError(
          'Insufficient Credits',
          `You need ${requiredCredits} credits to process ${queries.length} queries, but you only have ${availableCredits} credits available.`,
        );
        
        return;
      }
    }

    setProcessing(true);
    setStatus('processing');
    setMessage(`Processing ${queries.length} queries for ${brandName}...${!autoStart ? ` (${queries.length * 10} credits)` : ''}`);
    setProcessedResults([]); // Reset processed results
    cancelledRef.current = false;

    // Notify parent that processing has started
    if (onStart) {
      onStart();
    }

    try {
      // Get Firebase ID token for authentication with retry logic
      const idToken = await getFirebaseIdTokenWithRetry(3, 1000);
      
      if (!idToken) {
        throw new Error('Failed to get authentication token. Please sign in again.');
      }

      // Generate unique processing session identifier
      const processingSessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const processingSessionTimestamp = new Date().toISOString();
      
      // Process queries one by one and save incrementally
      const allResults: any[] = [];
      let processedCount = 0;

      for (const query of queries) {
        // Check if cancelled
        if (cancelledRef.current) {
          break;
        }

        try {
          // Notify parent that this specific query is starting
          if (onQueryStart) {
            onQueryStart(query.query);
          }

          setMessage(`Processing query ${processedCount + 1} of ${queries.length} for ${brandName}... (10 credits per query)`);
          
          // Process individual query with authentication
          
          let response;
          try {
            response = await fetch(`${window.location.origin}/api/user-query`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`, // Add Firebase ID token
              },
              body: JSON.stringify({
                query: query.query,
                context: `This query is related to ${targetBrand.companyName} in the ${query.category} category. Topic: ${query.keyword}.`,
                isAutoStart: autoStart // Add isAutoStart flag
              }),
            });
          } catch (fetchError) {
            console.error('❌ Fetch error:', fetchError);
            throw new Error(`Network error: ${fetchError instanceof Error ? fetchError.message : 'Unknown fetch error'}`);
          }

          if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ API error response:', errorText);
            
            // Parse error response if possible
            try {
              const errorData = JSON.parse(errorText);
              if (errorData.code === 'INSUFFICIENT_CREDITS') {
                // Show detailed credit error notification
                showError(
                  'Insufficient Credits',
                  `You need ${errorData.requiredCredits} credits but only have ${errorData.availableCredits} available.`,
                );
                throw new Error(`Insufficient credits: Need ${errorData.requiredCredits}, have ${errorData.availableCredits}`);
              } else if (errorData.code === 'AUTHENTICATION_REQUIRED') {
                showError(
                  'Authentication Failed',
                  'Please sign in again to continue processing queries.',
                );
                throw new Error('Authentication failed. Please sign in again.');
              } else {
                showError(
                  'Query Processing Failed',
                  errorData.error || 'An unexpected error occurred while processing your query.',
                );
                throw new Error(errorData.error || `Failed to process query (${response.status})`);
              }
            } catch (parseError) {
              showError(
                'Network Error',
                'Failed to communicate with the server. Please check your connection and try again.',
              );
              throw new Error(`Failed to process query (${response.status}): ${query.query.substring(0, 30)}...`);
            }
          }

          const queryData = await response.json();
          
          // Refresh user profile to update credits in sidebar
          if (queryData.userCredits) {
            await refreshUserProfile();
          }
          
          // Format the result with processing session information
          const queryResult: any = {
            date: new Date().toISOString(),
            processingSessionId,
            processingSessionTimestamp,
            query: query.query,
            keyword: query.keyword,
            category: query.category,
            results: {}
          };

          // Process the enhanced results from the new API
          if (queryData.success && queryData.results && Array.isArray(queryData.results)) {
            queryData.results.forEach((result: any) => {
              if (result.providerId === 'azure-openai-search') {
                queryResult.results.chatgpt = {
                  response: result.data?.content || '',
                  ...(result.error && { error: result.error }),
                  timestamp: result.timestamp || new Date().toISOString(),
                  responseTime: result.responseTime,
                  webSearchUsed: result.data?.webSearchUsed || false,
                  citations: result.data?.annotations?.length || 0
                };
              } else if (result.providerId === 'google-ai-overview') {
                queryResult.results.googleAI = {
                  response: `Found ${result.data?.totalItems || 0} search results`,
                  ...(result.error && { error: result.error }),
                  timestamp: result.timestamp || new Date().toISOString(),
                  responseTime: result.responseTime,
                  totalItems: result.data?.totalItems || 0,
                  organicResults: result.data?.organicResultsCount || 0,
                  peopleAlsoAsk: result.data?.peopleAlsoAskCount || 0,
                  location: result.data?.location || 'Unknown',
                  // Include AI Overview content if available
                  aiOverview: result.data?.aiOverview || null,
                  aiOverviewReferencesCount: result.data?.aiOverviewReferences?.length || 0,
                  hasAIOverview: result.data?.hasAIOverview || false,
                  serpFeaturesCount: result.data?.serpFeatures?.length || 0,
                  // Include other SERP data counts instead of arrays
                  relatedSearchesCount: result.data?.relatedSearches?.length || 0,
                  videoResultsCount: result.data?.videoResults?.length || 0,
                  // Remove rawDataForSEOResponse to reduce document size
                  hasRawData: !!(result.data?.rawDataForSEOResponse)
                };
              } else if (result.providerId === 'perplexity') {
                queryResult.results.perplexity = {
                  response: result.data?.content || '',
                  ...(result.error && { error: result.error }),
                  timestamp: result.timestamp || new Date().toISOString(),
                  responseTime: result.responseTime,
                  citations: result.data?.citations?.length || 0,
                  realTimeData: result.data?.realTimeData || false,
                  // Store flattened citation data to avoid nested arrays but preserve citation info
                  citationsData: result.data?.citations ? result.data.citations.join('|||') : '',
                  searchResultsData: result.data?.searchResults ? 
                    result.data.searchResults.map((r: any) => `${r.title || ''}|||${r.url || ''}`).join('###') : '',
                  structuredCitationsData: result.data?.structuredCitations ? 
                    result.data.structuredCitations.join('|||') : '',
                  // Store counts for display
                  citationsCount: result.data?.citations?.length || 0,
                  searchResultsCount: result.data?.searchResults?.length || 0,
                  structuredCitationsCount: result.data?.structuredCitations?.length || 0,
                  // Store metadata as simple key-value pairs (avoid nested objects/arrays)
                  hasMetadata: !!(result.data?.metadata),
                  hasUsageStats: !!(result.data?.usage)
                };
              }
            });
          }

          // Add credit information to the result
          if (queryData.userCredits) {
            queryResult.creditInfo = {
              creditsDeducted: queryData.userCredits.deducted || 10,
              creditsAfter: queryData.userCredits.after,
              totalCost: queryData.totalCost
            };
          }

          allResults.push(queryResult);
          processedCount++;

          // Update local state immediately to show progress
          setProcessedResults([...allResults]);
          
          // Notify parent component about progress
          if (onProgress) {
            onProgress([...allResults]);
          }

          // Save individual result immediately
          setMessage(`Saving result ${processedCount} of ${queries.length} for ${brandName}...`);
          
          // Save detailed results to separate collection first
          const { success: detailedSaveSuccess, error: detailedSaveError } = await saveDetailedQueryResults(
            targetBrandId!,
            targetBrand.userId,
            targetBrand.companyName,
            [queryResult] // Save just the current result to detailed collection
          );
          
          if (!detailedSaveSuccess) {
            console.error('❌ Error saving detailed result:', detailedSaveError);
            // Continue anyway, as the main brand document save is more important
          }
          
          const { error: updateError } = await updateBrandWithQueryResults(
            targetBrandId!,
            allResults // Save all results so far
          );

          if (updateError) {
            console.error('Error saving individual result:', updateError);
          }

          // Calculate and save incremental analytics after each query
          try {
            setMessage(`Updating analytics for ${brandName}...`);
            
            const analyticsData = calculateCumulativeAnalytics(
              targetBrand.userId,
              targetBrandId!,
              targetBrand.companyName,
              targetBrand.domain,
              processingSessionId,
              processingSessionTimestamp,
              allResults // Use all results processed so far
            );
            
            const { success: analyticsSaveSuccess, error: analyticsSaveError } = await saveBrandAnalytics(analyticsData);
            
            if (!analyticsSaveSuccess) {
              console.error('❌ Error saving incremental analytics:', analyticsSaveError);
            }
          } catch (analyticsError) {
            console.error('❌ Error calculating/saving incremental analytics:', analyticsError);
            // Don't fail the entire process for analytics errors
          }

          // Calculate and save competitor analytics after each query
          try {
            setMessage(`Updating competitor analytics for ${brandName}...`);
            
            // Convert brand competitors to Competitor format
            const competitors: Competitor[] = (targetBrand.competitors || []).map(comp => ({
              name: comp,
              domain: undefined, // Will be enhanced later to include competitor domains
              aliases: undefined
            }));
            
            if (competitors.length > 0) {
              const competitorAnalyticsData = calculateCumulativeCompetitorAnalytics(
                targetBrand.userId,
                targetBrandId!,
                targetBrand.companyName,
                targetBrand.domain,
                processingSessionId,
                processingSessionTimestamp,
                competitors,
                allResults // Use all results processed so far
              );
              
              const { result: competitorSaveResult, error: competitorSaveError } = await saveCompetitorAnalytics(competitorAnalyticsData);
              
              if (!competitorSaveResult?.success) {
                console.error('❌ Error saving incremental competitor analytics:', competitorSaveError);
              }
            }
          } catch (competitorAnalyticsError) {
            console.error('❌ Error calculating/saving competitor analytics:', competitorAnalyticsError);
            // Don't fail the entire process for competitor analytics errors
          }

          // Small delay between queries
          await new Promise(resolve => setTimeout(resolve, 1000));

        } catch (queryError) {
          console.error(`Error processing query: ${query.query}`, queryError);
          
          // If it's a credit or auth error, stop processing
          if (queryError instanceof Error && 
              (queryError.message.includes('Insufficient credits') || 
               queryError.message.includes('Authentication failed'))) {
            setStatus('error');
            setMessage(queryError.message);
            return;
          }
          
          processedCount++;
        }
      }

      // Check if cancelled
      if (cancelledRef.current) {
        setStatus('cancelled');
        setMessage(`Processing cancelled. Processed ${processedCount} of ${queries.length} queries.`);
        showWarning(
          '⏸️ Processing Cancelled',
          `Processed ${processedCount} of ${queries.length} queries before cancellation. You can resume processing the remaining queries anytime.`
        );
      } else {
        setStatus('success');
        setMessage(`Successfully processed ${processedCount} queries for ${brandName}! (${processedCount * 10} credits used)`);
        // Calculate next processing date (7 days from now)
        const nextProcessingDate = new Date();
        nextProcessingDate.setDate(nextProcessingDate.getDate() + 7);
        const nextProcessingFormatted = nextProcessingDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
        
        showSuccess(
          '🎉 All Queries Processed!',
          `Successfully processed ${processedCount} queries for ${brandName}. Used ${processedCount * 10} credits.`
        );
        
        // Show scheduling information after a brief delay
        setTimeout(() => {
          showInfo(
            '📅 Next Processing Scheduled',
            `Your next automatic processing is scheduled for ${nextProcessingFormatted}. You can also process queries manually anytime.`
          );
        }, 3000);
      }

      // Analytics are now calculated and saved incrementally after each query
      // No need for final analytics calculation since it's done per query

      // Calculate and save lifetime analytics after completing all queries to ensure citations table gets updated
      // Run this even if cancelled, as long as some queries were processed
      if (processedCount > 0) {
        try {
          setMessage(`Updating lifetime analytics for ${brandName}...`);
          
          const { result: lifetimeAnalytics, error: lifetimeError } = await calculateLifetimeBrandAnalytics(targetBrandId!);
          
          if (lifetimeError) {
            console.error('❌ Error calculating lifetime analytics:', lifetimeError);
          } else if (lifetimeAnalytics) {
            const { success: lifetimeSaveSuccess, error: lifetimeSaveError } = await saveLifetimeAnalytics(lifetimeAnalytics);
            
            if (!lifetimeSaveSuccess) {
              console.error('❌ Error saving lifetime analytics:', lifetimeSaveError);
            }
          }
        } catch (lifetimeError) {
          console.error('❌ Error in lifetime analytics processing:', lifetimeError);
          // Don't fail the entire process for lifetime analytics errors
        }
      }

      // Call the onComplete callback if provided
      if (onComplete) {
        onComplete({
          success: !cancelledRef.current,
          cancelled: cancelledRef.current,
          queryResults: allResults,
          summary: {
            totalQueries: queries.length,
            processedQueries: processedCount,
            totalErrors: queries.length - processedCount,
            creditsUsed: processedCount * 10
          }
        });
      }

      // Force a complete refresh of brand data to ensure all components update
      try {
        await refetchBrands();
      } catch (refreshError) {
        console.error('❌ Error during final brand data refresh:', refreshError);
      }

      // Reset status after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 5000);

    } catch (error) {
      setStatus('error');
      const errorMessage = error instanceof Error ? error.message : 'Failed to process queries';
      setMessage(errorMessage);
      console.error('Process queries error:', error);
      
      // Show error notification
      showError(
        '❌ Processing Failed',
        'An unexpected error occurred while processing queries. Please check your connection and try again.',
      );
      
      // Reset status after 5 seconds
      setTimeout(() => {
        setStatus('idle');
        setMessage('');
      }, 5000);
    } finally {
      setProcessing(false);
      cancelledRef.current = false; // Reset cancellation flag
      
      // Refresh user profile to show updated credits
      try {
        await refreshUserProfile();
      } catch (refreshError) {
        console.error('❌ Error refreshing user profile:', refreshError);
      }
      
      // Do a final refresh to get the latest data
      try {
        await refetchBrands();
      } catch (error) {
        console.error('Error doing final refresh:', error);
      }
    }
  };

  const handleStopProcessing = () => {
    cancelledRef.current = true;
    setMessage('Stopping processing...');
  };

  // Check if queries have been processed
  const getProcessedQueriesCount = () => {
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    return targetBrand?.queryProcessingResults?.length || 0;
  };

  const hasProcessedQueries = getProcessedQueriesCount() > 0;

  // Calculate required credits
  const getRequiredCredits = () => {
    const targetBrandId = brandId || selectedBrand?.id;
    const targetBrand = brands.find(b => b.id === targetBrandId);
    const queryCount = targetBrand?.queries?.length || 0;
    return queryCount * 10;
  };

  const requiredCredits = getRequiredCredits();
  const availableCredits = userProfile?.credits || 0;
  const hasEnoughCredits = availableCredits >= requiredCredits;

  // Button styling based on variant and size
  const baseStyles = 'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2';
  
  const getVariantStyles = () => {
    if (!hasEnoughCredits && requiredCredits > 0) {
      // Insufficient credits styling
      return {
        primary: 'bg-red-600 text-white cursor-not-allowed opacity-70',
        secondary: 'bg-white text-red-600 border border-red-600 cursor-not-allowed opacity-70',
        ghost: 'text-red-600 cursor-not-allowed opacity-70'
      };
    }
    
    if (hasProcessedQueries && status === 'idle') {
      // Different styling for reprocess button
      return {
        primary: 'bg-orange-600 text-white hover:bg-orange-700 focus:ring-orange-600',
        secondary: 'bg-white text-orange-600 border border-orange-600 hover:bg-orange-50 focus:ring-orange-600',
        ghost: 'text-orange-600 hover:bg-orange-100 focus:ring-orange-600'
      };
    }
    
    return {
      primary: 'bg-[#000C60] text-white hover:bg-[#000C60]/90 focus:ring-[#000C60]',
      secondary: 'bg-white text-[#000C60] border border-[#000C60] hover:bg-gray-50 focus:ring-[#000C60]',
      ghost: 'text-[#000C60] hover:bg-gray-100 focus:ring-[#000C60]'
    };
  };

  const variantStyles = getVariantStyles();

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-sm space-x-1.5',
    md: 'px-4 py-2 text-base space-x-2',
    lg: 'px-6 py-3 text-lg space-x-2.5'
  };

  const statusStyles = {
    idle: '',
    processing: 'opacity-80 cursor-not-allowed',
    success: 'bg-green-600 hover:bg-green-700 text-white',
    error: 'bg-red-600 hover:bg-red-700 text-white',
    cancelled: 'bg-yellow-600 hover:bg-yellow-700 text-white'
  };

  // Icon based on status and processed state
  const getIcon = () => {
    switch (status) {
      case 'processing':
        return <RefreshCw className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'} animate-spin`} />;
      case 'success':
        return <CheckCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      case 'error':
        return <AlertCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      case 'cancelled':
        return <StopCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
      default:
        if (!hasEnoughCredits && requiredCredits > 0) {
          return <AlertCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
        }
        if (hasProcessedQueries) {
          return <RotateCcw className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
        }
        return <Zap className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />;
    }
  };

  // Button text based on status and processed state
  const getButtonText = () => {
    if (message && status !== 'idle') {
      return message;
    }
    
    if (processing) {
      return 'Processing...';
    }
    
    if (!hasEnoughCredits && requiredCredits > 0) {
      return `Need ${requiredCredits} Credits (Have ${availableCredits})`;
    }
    
    if (hasProcessedQueries) {
      const count = getProcessedQueriesCount();
      return `Reprocess Queries (${requiredCredits} Credits)`;
    }
    
    return `Process Queries (${requiredCredits} Credits)`;
  };

  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center space-x-2">
        <button
          onClick={handleProcessQueries}
          disabled={processing || !user || !hasEnoughCredits}
          className={`
            ${baseStyles} 
            ${variantStyles[variant]} 
            ${sizeStyles[size]} 
            ${statusStyles[status]}
            ${className}
          `}
          title={
            !user ? 'Please sign in to process queries' : 
            !hasEnoughCredits ? `Need ${requiredCredits} credits, you have ${availableCredits}` :
            ''
          }
        >
          {getIcon()}
          <span>{getButtonText()}</span>
        </button>
        
        {/* Stop button - only visible during processing */}
        {processing && !cancelledRef.current && (
          <button
            onClick={handleStopProcessing}
            className={`
              ${baseStyles}
              bg-red-600 text-white hover:bg-red-700 focus:ring-red-600
              ${sizeStyles[size]}
              animate-fade-in
            `}
            title="Stop processing queries"
          >
            <StopCircle className={`${size === 'sm' ? 'h-3.5 w-3.5' : size === 'lg' ? 'h-5 w-5' : 'h-4 w-4'}`} />
            <span>Stop</span>
          </button>
        )}
      </div>
      
      {processing && (
        <p className="text-xs text-green-600 mt-1 font-medium text-center">
          ⚠️ Don't Refresh or Leave Page while Queries are Processing
        </p>
      )}
      
      {/* Credit information */}
      {!processing && requiredCredits > 0 && (
        <p className="text-xs text-muted-foreground mt-1 text-center">
          {hasEnoughCredits ? 
            `Ready: ${availableCredits} credits available` : 
            `Need ${requiredCredits - availableCredits} more credits`
          }
        </p>
      )}
    </div>
  );
} 