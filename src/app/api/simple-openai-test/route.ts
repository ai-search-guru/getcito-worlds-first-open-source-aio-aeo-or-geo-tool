import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    console.log('🔍 Testing basic OpenAI connection...');
    
    // Check if API key exists
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({
        success: false,
        error: 'OPENAI_API_KEY not found in environment variables'
      }, { status: 400 });
    }
    
    console.log('✅ API key found');
    
    // Try to import OpenAI
    let OpenAI;
    try {
      const openaiModule = await import('openai');
      OpenAI = openaiModule.default;
      console.log('✅ OpenAI package imported');
    } catch (error) {
      console.error('❌ OpenAI import error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to import OpenAI package',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
    
    // Try to create OpenAI client
    let client;
    try {
      client = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      console.log('✅ OpenAI client created');
    } catch (error) {
      console.error('❌ OpenAI client creation error:', error);
      return NextResponse.json({
        success: false,
        error: 'Failed to create OpenAI client',
        details: error instanceof Error ? error.message : 'Unknown error'
      }, { status: 500 });
    }
    
    // Try a simple chat completion (not the responses API yet)
    try {
      console.log('🚀 Testing basic chat completion...');
      
      const completion = await client.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "user", content: "Say 'Hello, this is a test!' and nothing else." }
        ],
        max_tokens: 20,
      });
      
      console.log('✅ Chat completion successful');
      
      return NextResponse.json({
        success: true,
        message: 'Basic OpenAI connection working!',
        testResult: {
          model: completion.model,
          response: completion.choices[0]?.message?.content || 'No response',
          usage: completion.usage,
        }
      });
      
    } catch (error) {
      console.error('❌ Chat completion error:', error);
      return NextResponse.json({
        success: false,
        error: 'Chat completion failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        errorType: error instanceof Error ? error.constructor.name : 'Unknown'
      }, { status: 500 });
    }
    
  } catch (error) {
    console.error('❌ General test error:', error);
    return NextResponse.json({
      success: false,
      error: 'Test failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
} 