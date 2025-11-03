'use client'
import React, { useEffect } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';

interface ProtectedRouteProps {
  children: React.ReactNode;
  redirectTo?: string; // Optional custom redirect path
  loadingComponent?: React.ReactNode; // Optional custom loading component
  requireAdmin?: boolean; // Optional admin requirement
  adminEmails?: string[]; // Optional list of admin emails
}

// login page is /signin page

export default function ProtectedRoute({ 
  children, 
  redirectTo = "/signin",
  loadingComponent,
  requireAdmin = false,
  adminEmails = []
}: ProtectedRouteProps): React.ReactElement {
  const { user, loading } = useAuthContext();
  const router = useRouter();

  useEffect(() => {
    // Only redirect if not loading and user is null
    if (!loading && user == null) {
      router.push(redirectTo);
    }
  }, [user, loading, router, redirectTo]);

  // Show loading while auth state is being determined
  if (loading) {
    if (loadingComponent) {
      return <>{loadingComponent}</>;
    }
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Loading...</div>
      </div>
    );
  }

  // If user is not authenticated, show loading while redirecting
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Redirecting to sign in...</div>
      </div>
    );
  }

  // Check admin requirement if specified
  if (requireAdmin && adminEmails.length > 0) {
    const isAdmin = user.email && adminEmails.includes(user.email);
    if (!isAdmin) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="max-w-md p-8 bg-background border border-border rounded-lg text-center">
            <h2 className="text-xl font-semibold text-foreground mb-2">Access Denied</h2>
            <p className="text-muted-foreground">You don't have permission to access this page.</p>
          </div>
        </div>
      );
    }
  }

  // If user is authenticated (and admin if required), render the children
  return <>{children}</>;
} 