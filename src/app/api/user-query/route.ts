import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { auth } from '@/firebase/firebase-admin';
import { getUserProfileServer, deductCreditsServer } from '@/firebase/firestore/userProfileServer';

// Type definitions
interface UserQueryRequest {
  query: string;
  context?: string;
  userId?: string;
  isAutoStart?: boolean; // Add this flag
}

interface ProviderResult {
  providerId: string;
  status: 'success' | 'error';
  data?: any;
  error?: string;
  responseTime: number;
  cost: number;
  timestamp: string;
}

interface ModalQueryResult {
  success: boolean;
  query: string;
  totalResults: number;
  successfulResults: number;
  totalCost: number;
  totalTime: number;
  results: ProviderResult[];
  summary: {
    chatgptSearch?: {
      content: string;
      webSearchUsed: boolean;
      citations: number;
      responseTime: number;
    };
    googleAiOverview?: {
      totalItems: number;
      peopleAlsoAskCount: number;
      organicResultsCount: number;
      location: string;
      responseTime: number;
    };
    perplexity?: {
      content: string;
      citations: number;
      realTimeData: boolean;
      responseTime: number;
    };
  };
  timestamp: string;
  userCredits: {
    before: number;
    after: number;
    deducted: number;
  };
}

// Helper function to authenticate user and get profile
async function authenticateUser(request: NextRequest): Promise<{ uid: string; profile: any } | null> {
  try {
    // Check for Authorization header
    const authorization = request.headers.get('authorization');
    
    if (!authorization) {
      console.log('❌ No authorization header found');
      return null;
    }

    // Extract token from "Bearer <token>" format
    const token = authorization.split(' ')[1];
    
    if (!token) {
      console.log('❌ No token found in authorization header');
      return null;
    }

    console.log('🔑 Verifying Firebase ID token...');
    
    // Verify the Firebase ID token
    const decodedToken = await auth.verifyIdToken(token);
    
    if (!decodedToken || !decodedToken.uid) {
      console.log('❌ Invalid or expired Firebase ID token');
      return null;
    }

    console.log('✅ Firebase ID token verified successfully for user:', decodedToken.uid);
    console.log('🔍 Fetching user profile from Firestore...');

    // Get user profile from Firestore with better error handling
    try {
      const { result: userProfile, error: profileError } = await getUserProfileServer(decodedToken.uid);
      
      if (profileError) {
        console.error('❌ Error fetching user profile:', profileError);
        
        // Check if it's a permission error
        if (profileError.code === 'permission-denied') {
          console.error('🔥 Firestore permission denied error - possible causes:');
          console.error('   1. Firebase Admin SDK not properly authenticated');
          console.error('   2. Project ID mismatch between client and server');
          console.error('   3. Invalid Firebase Admin credentials');
          console.error('   4. Firestore rules blocking Admin SDK access');
          
          // Try to provide more specific debugging info
          console.log('🔍 Debug info:');
          console.log('   - User UID:', decodedToken.uid);
          console.log('   - Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
          console.log('   - Client Email:', process.env.FIREBASE_CLIENT_EMAIL?.substring(0, 20) + '...');
        }
        
        return null;
      }

      if (!userProfile) {
        console.log('❌ User profile not found for UID:', decodedToken.uid);
        return null;
      }

      console.log('✅ User profile fetched successfully:', {
        uid: decodedToken.uid,
        email: userProfile.email,
        credits: userProfile.credits
      });

      return {
        uid: decodedToken.uid,
        profile: userProfile
      };

    } catch (firestoreError) {
      console.error('❌ Firestore access error:', firestoreError);
      return null;
    }

  } catch (error) {
    console.error('❌ Authentication error:', error);
    return null;
  }
}

// Main POST handler
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    const body: UserQueryRequest = await request.json();
    const { query, context, isAutoStart } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Query is required and must be a string' },
        { status: 400 }
      );
    }

    // Authenticate user
    const authResult = await authenticateUser(request);
    
    if (!authResult) {
      return NextResponse.json(
        { 
          error: 'Authentication required. Please provide a valid authorization token.',
          code: 'AUTHENTICATION_REQUIRED'
        },
        { status: 401 }
      );
    }

    const { uid, profile } = authResult;
    const requiredCredits = 10; // Cost for processing a query

    console.log('📝 Processing user query with authentication:', {
      query: query.substring(0, 100) + '...',
      userId: uid,
      userCredits: profile.credits,
      requiredCredits,
      isAutoStart,
      timestamp: new Date().toISOString()
    });

    // Skip credit check if this is an auto-started query
    if (!isAutoStart) {
      // Check if user has sufficient credits
      if (profile.credits < requiredCredits) {
        return NextResponse.json(
          {
            error: `Insufficient credits. Required: ${requiredCredits}, Available: ${profile.credits}`,
            code: 'INSUFFICIENT_CREDITS',
            requiredCredits,
            availableCredits: profile.credits
          },
          { status: 402 }
        );
      }

      // Deduct credits BEFORE processing
      console.log('💰 Deducting credits before processing...');
      const { result: deductionSuccess, error: deductionError } = await deductCreditsServer(uid, requiredCredits);
      
      if (!deductionSuccess) {
        console.error('❌ Credit deduction failed:', deductionError);
        return NextResponse.json(
          {
            error: 'Failed to deduct credits. Please try again.',
            code: 'CREDIT_DEDUCTION_FAILED'
          },
          { status: 500 }
        );
      }

      console.log('✅ Credits deducted successfully:', {
        userId: uid,
        deducted: requiredCredits,
        previousCredits: profile.credits,
        newCredits: profile.credits - requiredCredits
      });
    } else {
      console.log('🚀 Auto-start query - skipping credit check and deduction');
    }

    // Initialize provider manager
    const providerManager = new ProviderManager();
    
    // Use only the 3 selected providers
    const selectedProviders = ['azure-openai-search', 'google-ai-overview', 'perplexity'];
    
    // Create API request for the 3 providers
    const apiRequest = {
      id: `user-query-${Date.now()}`,
      prompt: query,
      providers: selectedProviders,
      priority: 'high' as const,
      userId: uid,
      createdAt: new Date(),
      metadata: {
        context,
        type: 'user-query',
        creditsDeducted: requiredCredits
      }
    };

    console.log('🚀 Executing query with 3 providers:', selectedProviders);
    
    // Execute the request
    const jobResult = await providerManager.executeRequest(apiRequest);
    
    const totalTime = Date.now() - startTime;
    
    // Transform results for modal display
    const modalResults: ProviderResult[] = jobResult.results.map(result => ({
      providerId: result.providerId,
      // Only allow 'success' or 'error' as valid statuses
      status: result.status === 'success' || result.status === 'error' ? result.status : 'error',
      data: result.data,
      error: result.error,
      responseTime: result.responseTime,
      cost: result.cost,
      timestamp: result.timestamp instanceof Date
        ? result.timestamp.toISOString()
        : new Date(result.timestamp).toISOString()
    }));

    // Create summary for easy modal display
    const summary: any = {};
    
    jobResult.results.forEach(result => {
      if (result.status === 'success' && result.data) {
        switch (result.providerId) {
          case 'azure-openai-search':
            summary.chatgptSearch = {
              content: result.data.content || '',
              webSearchUsed: result.data.webSearchUsed || false,
              citations: result.data.annotations?.length || 0,
              responseTime: result.responseTime
            };
            break;
            
          case 'google-ai-overview':
            summary.googleAiOverview = {
              totalItems: result.data.totalItems || 0,
              peopleAlsoAskCount: result.data.peopleAlsoAskCount || 0,
              organicResultsCount: result.data.organicResultsCount || 0,
              location: result.data.location || 'Unknown',
              responseTime: result.responseTime
            };
            break;
            
          case 'perplexity':
            summary.perplexity = {
              content: result.data.content || '',
              citations: result.data.citations?.length || 0,
              realTimeData: result.data.realTimeData || false,
              responseTime: result.responseTime
            };
            break;
        }
      }
    });

    const modalResult: ModalQueryResult = {
      success: true,
      query,
      totalResults: jobResult.results.length,
      successfulResults: jobResult.results.filter(r => r.status === 'success').length,
      totalCost: jobResult.totalCost,
      totalTime,
      results: modalResults,
      summary,
      timestamp: new Date().toISOString(),
      userCredits: {
        before: profile.credits,
        after: profile.credits - requiredCredits,
        deducted: requiredCredits
      }
    };

    console.log('✅ User query processed successfully:', {
      query: query.substring(0, 50) + '...',
      userId: uid,
      totalResults: modalResult.totalResults,
      successfulResults: modalResult.successfulResults,
      totalCost: modalResult.totalCost,
      totalTime: modalResult.totalTime,
      creditsDeducted: requiredCredits
    });

    return NextResponse.json(modalResult);

  } catch (error) {
    const totalTime = Date.now() - startTime;
    
    console.error('❌ User query error:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      totalTime
    });
    
    return NextResponse.json({
      success: false,
      error: 'Failed to process user query',
      message: error instanceof Error ? error.message : 'Unknown error',
      totalTime,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

// GET handler for API documentation
export async function GET(request: NextRequest) {
  return NextResponse.json({
    message: 'Enhanced User Query API - 3 Provider System with Credit Deduction',
    authentication: {
      required: true,
      method: 'Bearer token in Authorization header',
      description: 'Firebase ID token required for authentication'
    },
    creditCost: {
      perQuery: 10,
      description: 'Credits are deducted before processing begins'
    },
    providers: [
      {
        name: 'ChatGPT Search',
        capabilities: ['AI reasoning', 'Real-time web search', 'Citations'],
        responseTime: '8-15 seconds',
        cost: '~$0.003 per request'
      },
      {
        name: 'Google AI Overview',
        capabilities: ['SERP data', 'People Also Ask', 'Organic results', 'AI Overview'],
        responseTime: '14-17 seconds', 
        cost: '~$0.0046 per request'
      },
      {
        name: 'Perplexity AI',
        capabilities: ['AI reasoning', 'Real-time web search', 'Citations', 'Current information'],
        responseTime: '7-8 seconds',
        cost: '~$0.005 per request'
      }
    ],
    endpoints: {
      POST: {
        description: 'Submit a query to the 3 selected AI providers (requires authentication)',
        headers: {
          'Authorization': 'Bearer <firebase-id-token>',
          'Content-Type': 'application/json'
        },
        body: {
          query: 'Your question here (required)',
          context: 'Additional context for the query (optional)'
        }
      }
    },
    example: {
      query: 'What are the latest developments in AI technology?',
      context: 'Focus on 2025 developments'
    },
    modalFormat: {
      description: 'Results are formatted for easy modal display with credit tracking',
      structure: {
        summary: 'Quick overview of each provider result',
        results: 'Detailed provider responses',
        performance: 'Response times and costs',
        userCredits: 'Credit balance before/after processing'
      }
    },
    errorCodes: {
      AUTHENTICATION_REQUIRED: 'No valid authorization token provided',
      INSUFFICIENT_CREDITS: 'User does not have enough credits (requires 10)',
      CREDIT_DEDUCTION_FAILED: 'Failed to deduct credits from user account'
    }
  });
} 