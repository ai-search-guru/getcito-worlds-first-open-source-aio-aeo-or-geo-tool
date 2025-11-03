import { NextRequest, NextResponse } from 'next/server';
import { PerplexityProvider } from '@/lib/api-providers/perplexity-provider';

export async function POST(request: NextRequest) {
  try {
    console.log('🧪 Testing Perplexity provider...');
    
    const body = await request.json();
    
    // Validate request
    if (!body.prompt && !body.input && !body.messages) {
      return NextResponse.json({
        success: false,
        error: 'Missing prompt, input, or messages in request body'
      }, { status: 400 });
    }
    
    // Check for API key
    if (!process.env.PERPLEXITY_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'PERPLEXITY_API_KEY environment variable not set'
      }, { status: 500 });
    }
    
    // Initialize provider
    const provider = new PerplexityProvider({
      apiKey: process.env.PERPLEXITY_API_KEY,
      timeout: 30000,
      retryAttempts: 3
    });
    
    console.log('🔄 Executing Perplexity request...');
    
    // Execute request
    const result = await provider.execute({
      prompt: body.prompt,
      input: body.input,
      messages: body.messages,
      model: body.model || 'sonar',
      temperature: body.temperature || 0.7,
      max_tokens: body.max_tokens || 1000
    });
    
    console.log('✅ Perplexity test completed:', {
      status: result.status,
      responseTime: result.responseTime,
      cost: result.cost,
      hasContent: !!result.data?.content
    });
    
    return NextResponse.json({
      success: true,
      ...result
    });
    
  } catch (error) {
    console.error('❌ Perplexity test error:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : null
    }, { status: 500 });
  }
} 