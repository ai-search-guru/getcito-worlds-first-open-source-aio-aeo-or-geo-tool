import { NextApiRequest, NextApiResponse } from 'next';
import { auth } from '@/firebase/firebase-admin';
import { getUserProfile } from '@/firebase/firestore/userProfile';

// Extended request interface with user context
export interface AuthenticatedRequest extends NextApiRequest {
  user: {
    uid: string;
    email: string;
    credits: number;
    profile: any;
  };
}

// Type for authenticated API handler
export type AuthenticatedApiHandler = (
  req: AuthenticatedRequest,
  res: NextApiResponse
) => Promise<void>;

// Authentication middleware
export function withAuth(handler: AuthenticatedApiHandler) {
  return async (req: NextApiRequest, res: NextApiResponse): Promise<void> => {
    try {
      // Check for Authorization header
      const authorization = req.headers.authorization;
      
      if (!authorization) {
        return res.status(401).json({ 
          error: 'Not authenticated. No authorization header provided.',
          code: 'NO_AUTH_HEADER'
        });
      }

      // Extract token from "Bearer <token>" format
      const token = authorization.split(' ')[1];
      
      if (!token) {
        return res.status(401).json({ 
          error: 'Not authenticated. No token provided.',
          code: 'NO_TOKEN'
        });
      }

      // Verify the Firebase ID token
      let decodedToken;
      try {
        decodedToken = await auth.verifyIdToken(token);
        
        if (!decodedToken || !decodedToken.uid) {
          return res.status(401).json({ 
            error: 'Not authenticated. Invalid token.',
            code: 'INVALID_TOKEN'
          });
        }
      } catch (verifyError) {
        console.error('❌ Token verification error:', verifyError);
        return res.status(401).json({ 
          error: 'Not authenticated. Token verification failed.',
          code: 'TOKEN_VERIFICATION_FAILED',
          details: verifyError instanceof Error ? verifyError.message : 'Unknown error'
        });
      }

      // Get user profile from Firestore
      const { result: userProfile, error: profileError } = await getUserProfile(decodedToken.uid);
      
      if (profileError || !userProfile) {
        console.error('❌ User profile fetch error:', profileError);
        return res.status(404).json({ 
          error: 'User profile not found.',
          code: 'USER_PROFILE_NOT_FOUND'
        });
      }

      // Attach user information to request
      const authenticatedReq = req as AuthenticatedRequest;
      authenticatedReq.user = {
        uid: decodedToken.uid,
        email: decodedToken.email || userProfile.email,
        credits: userProfile.credits,
        profile: userProfile
      };

      console.log('✅ User authenticated:', {
        uid: decodedToken.uid,
        email: decodedToken.email,
        credits: userProfile.credits
      });

      // Call the actual handler
      return await handler(authenticatedReq, res);

    } catch (error) {
      console.error('❌ Authentication middleware error:', error);
      return res.status(500).json({ 
        error: 'Internal server error during authentication.',
        code: 'AUTH_MIDDLEWARE_ERROR'
      });
    }
  };
}

// Helper function to check if user has sufficient credits
export function checkCredits(requiredCredits: number) {
  return (handler: AuthenticatedApiHandler): AuthenticatedApiHandler => {
    return async (req: AuthenticatedRequest, res: NextApiResponse): Promise<void> => {
      if (req.user.credits < requiredCredits) {
        return res.status(402).json({
          error: `Insufficient credits. Required: ${requiredCredits}, Available: ${req.user.credits}`,
          code: 'INSUFFICIENT_CREDITS',
          requiredCredits,
          availableCredits: req.user.credits
        });
      }
      
      return await handler(req, res);
    };
  };
}

// Combined middleware for authentication + credit checking
export function withAuthAndCredits(requiredCredits: number) {
  return (handler: AuthenticatedApiHandler) => {
    return withAuth(checkCredits(requiredCredits)(handler));
  };
} 