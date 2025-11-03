import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing OpenAI Responses API...');
    
    // Import OpenAI
    const openaiModule = await import('openai');
    const OpenAI = openaiModule.default;
    
    const client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    
    // Test if the responses API exists
    if (!client.responses) {
      return NextResponse.json({
        success: false,
        error: 'Responses API not available',
        message: 'The OpenAI responses API (used for web search) is not available with your current setup.',
        suggestion: 'This API might be in beta or require special access. Let\'s use a different approach.',
        clientMethods: Object.keys(client).filter(key => typeof client[key] === 'object')
      });
    }
    
    // Test if responses.create exists
    if (!client.responses.create) {
      return NextResponse.json({
        success: false,
        error: 'Responses create method not available',
        message: 'The responses.create method is not available.',
        availableMethods: Object.keys(client.responses)
      });
    }
    
    // Try to make a simple responses API call
    try {
      console.log('🚀 Testing responses.create...');
      
      const response = await client.responses.create({
        model: "gpt-4.1",
        tools: [{ type: "web_search_preview" }],
        input: "What is the capital of France?",
      });
      
      console.log('✅ Responses API call successful');
      
      return NextResponse.json({
        success: true,
        message: 'OpenAI Responses API is working!',
        testResult: {
          model: response.model,
          hasOutput: !!response.output_text,
          outputLength: response.output_text?.length || 0,
          outputPreview: response.output_text?.substring(0, 100) + '...',
        }
      });
      
    } catch (error) {
      console.error('❌ Responses API call error:', error);
      
      return NextResponse.json({
        success: false,
        error: 'Responses API call failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown',
        message: 'The responses API exists but the call failed. This might be due to model availability or API access.',
        suggestion: 'We can implement ChatGPT Search using the regular chat completions API instead.'
      });
    }
    
  } catch (error) {
    console.error('❌ Responses API test error:', error);
    return NextResponse.json({
      success: false,
      error: 'Responses API test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 