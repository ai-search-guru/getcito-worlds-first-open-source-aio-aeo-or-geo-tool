import { NextRequest, NextResponse } from 'next/server';
import { getUserBrands, QueryProcessingResult } from '@/firebase/firestore/getUserBrands';

// Process a single query through AI providers
async function processQuery(queryText: string, context?: string): Promise<any> {
  try {
    if (!process.env.NEXT_PUBLIC_APP_URL) {
      throw new Error('NEXT_PUBLIC_APP_URL environment variable is not set');
    }
    const response = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/user-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: queryText,
        provider: 'both', // Query both providers
        context: context || 'Please provide a comprehensive and helpful response.'
      })
    });

    if (!response.ok) {
      throw new Error(`Failed to query AI providers: ${response.statusText}`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error processing query:', error);
    return {
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

// Main handler to process queries for a user's brands
export async function POST(request: NextRequest) {
  try {
    const { brandData, queries } = await request.json();

    if (!brandData || !queries) {
      return NextResponse.json(
        { error: 'brandData and queries are required' },
        { status: 400 }
      );
    }

    console.log('🚀 Processing queries for brand:', brandData.companyName);

    const queryResults: QueryProcessingResult[] = [];
    const errors: any[] = [];
    
    // Generate unique processing session identifier for this API call
    const processingSessionId = `api_session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const processingSessionTimestamp = new Date().toISOString();
    
    console.log(`🔄 Starting API processing session: ${processingSessionId} at ${processingSessionTimestamp}`);
    
    // Process each query
    for (const query of queries) {
      try {
        console.log(`  📝 Processing query: "${query.query.substring(0, 50)}..."`);
        
        // Process through AI providers
        const aiResult = await processQuery(
          query.query,
          `This query is related to ${brandData.companyName} in the ${query.category} category. Topic: ${query.keyword}.`
        );

        console.log(`  📊 AI Result for query:`, {
          query: query.query.substring(0, 50),
          hasResults: !!aiResult.results,
          resultsCount: aiResult.results?.length,
          error: aiResult.error
        });

        // Format the results
        const queryResult: QueryProcessingResult = {
          date: new Date().toISOString(),
          processingSessionId,
          processingSessionTimestamp,
          query: query.query,
          keyword: query.keyword,
          category: query.category,
          results: {}
        };

        // Process the results array from the API
        if (aiResult.results && Array.isArray(aiResult.results)) {
          aiResult.results.forEach((result: any) => {
            if (result.provider === 'openai') {
              queryResult.results.chatgpt = {
                response: result.response || '',
                error: result.error,
                timestamp: result.timestamp || new Date().toISOString(),
                responseTime: undefined,
                tokenCount: undefined
              };
            } else if (result.provider === 'gemini') {
              queryResult.results.gemini = {
                response: result.response || '',
                error: result.error,
                timestamp: result.timestamp || new Date().toISOString(),
                responseTime: undefined,
                tokenCount: undefined
              };
            }
          });
        }

        // TODO: Add Perplexity when available
        // queryResult.results.perplexity = { ... };

        queryResults.push(queryResult);

        // Add a small delay between queries to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        console.error(`  ❌ Error processing query: ${error}`);
        errors.push({
          query: query.query,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    console.log('✅ Processing complete:', {
      totalQueries: queries.length,
      processedQueries: queryResults.length,
      errors: errors.length
    });

    // Return the results for the client to update Firestore
    return NextResponse.json({
      success: true,
      brandId: brandData.id,
      brandName: brandData.companyName,
      queryResults,
      errors,
      summary: {
        totalQueries: queries.length,
        processedQueries: queryResults.length,
        totalErrors: errors.length
      }
    });

  } catch (error) {
    console.error('❌ Error in process-user-queries:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error', 
        details: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    );
  }
}

 