import { NextRequest } from 'next/server';

/**
 * Verify Firebase ID token from request headers
 * This is a simple example - in production you'd want to use Firebase Admin SDK
 */
export async function verifyAuthToken(request: NextRequest): Promise<{ isValid: boolean; userId?: string; error?: string }> {
  try {
    // Get the Authorization header
    const authHeader = request.headers.get('authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return { isValid: false, error: 'No valid authorization header found' };
    }

    // Extract the token
    const token = authHeader.replace('Bearer ', '');
    
    if (!token) {
      return { isValid: false, error: 'No token found in authorization header' };
    }

    // In a real application, you would verify the token using Firebase Admin SDK:
    // const admin = require('firebase-admin');
    // const decodedToken = await admin.auth().verifyIdToken(token);
    // return { isValid: true, userId: decodedToken.uid };

    // For now, we'll do basic validation (this is just for demonstration)
    // In production, ALWAYS use Firebase Admin SDK for server-side token verification
    
    // Basic token format check (Firebase tokens are JWTs with 3 parts separated by dots)
    const tokenParts = token.split('.');
    if (tokenParts.length !== 3) {
      return { isValid: false, error: 'Invalid token format' };
    }

    // For this example, we'll assume the token is valid if it has the right format
    // In production, you MUST verify the token signature and claims
    console.log('⚠️ WARNING: This is a demo implementation. Use Firebase Admin SDK in production!');
    
    return { 
      isValid: true, 
      userId: 'demo-user-id' // In production, this would come from the verified token
    };

  } catch (error) {
    console.error('Token verification error:', error);
    return { isValid: false, error: 'Token verification failed' };
  }
}

/**
 * Middleware helper to check if user is authenticated
 */
export function requireAuth(handler: (request: NextRequest, userId: string) => Promise<Response>) {
  return async (request: NextRequest) => {
    const { isValid, userId, error } = await verifyAuthToken(request);
    
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized', details: error }),
        { 
          status: 401, 
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    return handler(request, userId!);
  };
} 