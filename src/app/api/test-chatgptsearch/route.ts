import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing ChatGPT Search Provider...');
    
    // Initialize provider manager
    const providerManager = new ProviderManager();
    
    // Check if ChatGPT Search provider is available
    const availableProviders = providerManager.getAvailableProviders();
    console.log('📋 Available providers:', availableProviders);
    
    if (!availableProviders.includes('chatgptsearch')) {
      return NextResponse.json({
        success: false,
        error: 'ChatGPT Search provider not available',
        availableProviders,
        message: 'Check your OPENAI_API_KEY environment variable'
      }, { status: 400 });
    }
    
    // Test with a simple query
    const testRequest = {
      id: `test-${Date.now()}`,
      prompt: 'What are the latest developments in AI technology this week?',
      providers: ['chatgptsearch'],
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
    
    // Get ChatGPT Search specific result
    const chatgptSearchResult = result.results.find(r => r.providerId === 'chatgptsearch');
    
    if (chatgptSearchResult && chatgptSearchResult.status === 'success') {
      return NextResponse.json({
        success: true,
        message: 'ChatGPT Search provider is working correctly!',
        testResults: {
          providerId: chatgptSearchResult.providerId,
          status: chatgptSearchResult.status,
          responseTime: chatgptSearchResult.responseTime,
          cost: chatgptSearchResult.cost,
          model: chatgptSearchResult.data?.model,
          searchEnabled: chatgptSearchResult.data?.searchEnabled,
          webSearchUsed: chatgptSearchResult.data?.webSearchUsed,
          responseLength: chatgptSearchResult.data?.content?.length,
          responsePreview: chatgptSearchResult.data?.content?.substring(0, 200) + '...',
          fullResponse: chatgptSearchResult.data?.content,
          annotations: chatgptSearchResult.data?.annotations || [],
          annotationsCount: chatgptSearchResult.data?.annotationsCount || 0,
          metadata: chatgptSearchResult.data?.metadata || {},
        },
        processingTime,
        totalCost: result.totalCost,
        availableProviders
      });
    } else {
      return NextResponse.json({
        success: false,
        error: 'ChatGPT Search provider failed',
        errorDetails: chatgptSearchResult?.error,
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
    
    console.log('🔍 Testing ChatGPT Search with custom query:', query);
    
    const providerManager = new ProviderManager();
    
    const testRequest = {
      id: `custom-test-${Date.now()}`,
      prompt: query,
      providers: ['chatgptsearch'],
      priority: 'high' as const,
      userId: 'test-user',
      createdAt: new Date(),
    };
    
    const startTime = Date.now();
    const result = await providerManager.executeRequest(testRequest);
    const processingTime = Date.now() - startTime;
    
    const chatgptSearchResult = result.results.find(r => r.providerId === 'chatgptsearch');
    
    return NextResponse.json({
      success: chatgptSearchResult?.status === 'success',
      query,
      result: {
        ...chatgptSearchResult,
        // Include detailed response data
        fullResponse: chatgptSearchResult?.data?.content,
        annotations: chatgptSearchResult?.data?.annotations || [],
        annotationsCount: chatgptSearchResult?.data?.annotationsCount || 0,
        metadata: chatgptSearchResult?.data?.metadata || {},
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