import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Get the pathname of the request (e.g. /, /dashboard, /api/protected)
  const { pathname } = request.nextUrl;

  // Check if it's a dashboard route or protected API route
  const isDashboardRoute = pathname.startsWith('/dashboard');
  const isProtectedApiRoute = pathname.startsWith('/api/') && 
    !pathname.startsWith('/api/auth') && // Allow auth endpoints
    !pathname.includes('public'); // Allow public endpoints if any

  // For now, we'll let the client-side handle dashboard protection
  // since we're using Firebase Auth which requires client-side token verification
  // API routes can be protected here if needed with proper token verification

  if (isProtectedApiRoute) {
    // For API routes, you could add additional protection here
    // For example, check for valid Firebase tokens in the headers
    // This is optional since Firebase security rules handle most protection
    
    // Example: Check for Authorization header
    // const authHeader = request.headers.get('authorization');
    // if (!authHeader || !authHeader.startsWith('Bearer ')) {
    //   return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    // }
  }

  // Continue with the request
  return NextResponse.next();
}

// Configure which routes the middleware should run on
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api/auth (authentication endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public files (public folder)
     */
    '/((?!api/auth|_next/static|_next/image|favicon.ico|.*\\.png$|.*\\.jpg$|.*\\.jpeg$|.*\\.gif$|.*\\.svg$|.*\\.webp$).*)',
  ],
}; 