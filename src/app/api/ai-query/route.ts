import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { APIRequest } from '@/lib/api-providers/types';

const providerManager = new ProviderManager();

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, providers = [], priority = 'medium', userId } = body;

    console.log('🚀 AI Query API Request:', {
      prompt: prompt?.substring(0, 100) + '...',
      providers,
      priority,
      userId,
      timestamp: new Date().toISOString()
    });

    if (!prompt) {
      return NextResponse.json(
        { error: 'Prompt is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Create API request
    const apiRequest: APIRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      prompt,
      providers,
      priority,
      userId,
      metadata: {
        userAgent: request.headers.get('user-agent'),
        timestamp: new Date().toISOString(),
      },
      createdAt: new Date(),
    };

    console.log('📝 Created API Request:', {
      id: apiRequest.id,
      providers: apiRequest.providers,
      priority: apiRequest.priority
    });

    // Execute request across providers
    console.log('⚡ Executing request across providers...');
    const result = await providerManager.executeRequest(apiRequest);

    console.log('✅ AI Query API Response:', {
      requestId: result.requestId,
      resultsCount: result.results?.length || 0,
      totalCost: result.totalCost,
      aggregatedDataKeys: Object.keys(result.aggregatedData || {}),
      completedAt: result.completedAt
    });

    return NextResponse.json({
      success: true,
      requestId: result.requestId,
      data: result.aggregatedData,
      results: result.results,
      totalCost: result.totalCost,
      completedAt: result.completedAt,
      // Add debug info to see in browser
      debug: {
        providersExecuted: result.results?.map(r => r.providerId) || [],
        serverLogs: "Check server console for detailed logs",
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('API Query Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    // Get provider status
    const status = await providerManager.getProviderStatus();
    const availableProviders = providerManager.getAvailableProviders();

    return NextResponse.json({
      success: true,
      providers: availableProviders,
      status,
    });

  } catch (error) {
    console.error('Provider Status Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 