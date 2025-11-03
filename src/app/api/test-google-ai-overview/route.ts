import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing Google AI Overview Provider...');
    
    // Initialize provider manager
    const providerManager = new ProviderManager();
    
    // Check if Google AI Overview provider is available
    const availableProviders = providerManager.getAvailableProviders();
    console.log('📋 Available providers:', availableProviders);
    
    if (!availableProviders.includes('google-ai-overview')) {
      return NextResponse.json({
        success: false,
        error: 'Google AI Overview provider not available',
        availableProviders,
        message: 'Google AI Overview provider not configured'
      }, { status: 400 });
    }
    
    // Test with a simple query
    const testRequest = {
      id: `test-${Date.now()}`,
      prompt: 'best AI tools for content creation',
      providers: ['google-ai-overview'],
      priority: 'high' as const,
      userId: 'test-user',
      createdAt: new Date(),
    };
    
    console.log('🚀 Executing test request...');
    const startTime = Date.now();
    
    const result = await providerManager.executeRequest(testRequest);
    
    const processingTime = Date.now() - startTime;
    
    console.log('✅ Test completed:', {
      requestId: result.requestId,
      totalResults: result.results.length,
      successfulResults: result.results.filter(r => r.status === 'success').length,
      totalCost: result.totalCost,
      processingTime: processingTime + 'ms'
    });
    
    // Get Google AI Overview specific result
    const googleAIOverviewResult = result.results.find(r => r.providerId === 'google-ai-overview');
    
    if (googleAIOverviewResult && googleAIOverviewResult.status === 'success') {
      return NextResponse.json({
        success: true,
        message: 'Google AI Overview provider is working correctly!',
        testResults: {
          providerId: googleAIOverviewResult.providerId,
          status: googleAIOverviewResult.status,
          responseTime: googleAIOverviewResult.responseTime,
          cost: googleAIOverviewResult.cost,
          keyword: googleAIOverviewResult.data?.keyword,
          location: googleAIOverviewResult.data?.location,
          device: googleAIOverviewResult.data?.device,
          hasAIOverview: !!googleAIOverviewResult.data?.aiOverview,
          organicResultsCount: googleAIOverviewResult.data?.organicResultsCount || 0,
          peopleAlsoAskCount: googleAIOverviewResult.data?.peopleAlsoAsk?.length || 0,
          relatedSearchesCount: googleAIOverviewResult.data?.relatedSearches?.length || 0,
          aiOverviewPreview: googleAIOverviewResult.data?.aiOverview ? 
            JSON.stringify(googleAIOverviewResult.data.aiOverview).substring(0, 200) + '...' : 
            'No AI Overview available',
        },
        processingTime,
        totalCost: result.totalCost,
        availableProviders
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'Google AI Overview provider failed',
        errorDetails: googleAIOverviewResult?.error,
        availableProviders,
        allResults: result.results.map(r => ({
          providerId: r.providerId,
          status: r.status,
          error: r.error
        }))
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Test execution failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { query } = await request.json();
    
    if (!query) {
      return NextResponse.json({
        success: false,
        error: 'Query parameter is required'
      }, { status: 400 });
    }
    
    console.log('🔍 Testing Google AI Overview with custom query:', query);
    
    const providerManager = new ProviderManager();
    
    const testRequest = {
      id: `custom-test-${Date.now()}`,
      prompt: query,
      providers: ['google-ai-overview'],
      priority: 'high' as const,
      userId: 'test-user',
      createdAt: new Date(),
    };
    
    const startTime = Date.now();
    const result = await providerManager.executeRequest(testRequest);
    const processingTime = Date.now() - startTime;
    
    const googleAIOverviewResult = result.results.find(r => r.providerId === 'google-ai-overview');
    
    return NextResponse.json({
      success: googleAIOverviewResult?.status === 'success',
      query,
      result: {
        ...googleAIOverviewResult,
        // Include detailed response data
        fullAIOverview: googleAIOverviewResult?.data?.aiOverview,
        organicResults: googleAIOverviewResult?.data?.organicResults || [],
        peopleAlsoAsk: googleAIOverviewResult?.data?.peopleAlsoAsk || [],
        relatedSearches: googleAIOverviewResult?.data?.relatedSearches || [],
        metadata: googleAIOverviewResult?.data?.metadata || {},
      },
      processingTime,
      totalCost: result.totalCost
    });
    
  } catch (error) {
    console.error('❌ Custom test failed:', error);
    return NextResponse.json({
      success: false,
      error: 'Custom test execution failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 