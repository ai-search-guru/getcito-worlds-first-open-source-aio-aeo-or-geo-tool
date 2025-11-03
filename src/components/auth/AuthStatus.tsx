'use client'
import React from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { User, Lock, LogOut } from 'lucide-react';
import signOut from '@/firebase/auth/signOut';
import { useRouter } from 'next/navigation';

interface AuthStatusProps {
  showSignOut?: boolean;
  className?: string;
}
// test comment 
export default function AuthStatus({ showSignOut = true, className = '' }: AuthStatusProps): React.ReactElement {
  const { user, loading } = useAuthContext();
  const router = useRouter();

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (!error) {
      router.push('/');
    }
  };

  if (loading) {
    return (
      <div className={`flex items-center space-x-2 text-muted-foreground ${className}`}>
        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>
        <span className="text-sm">Loading...</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className={`flex items-center space-x-2 text-muted-foreground ${className}`}>
        <Lock className="h-4 w-4" />
        <span className="text-sm">Not authenticated</span>
      </div>
    );
  }

  return (
    <div className={`flex items-center justify-between space-x-3 ${className}`}>
      <div className="flex items-center space-x-2">
        <User className="h-4 w-4 text-[#000C60]" />
        <div className="flex flex-col">
          <span className="text-sm font-medium text-foreground">
            {user.displayName || user.email}
          </span>
          <span className="text-xs text-muted-foreground">
            Authenticated
          </span>
        </div>
      </div>
      
      {showSignOut && (
        <button
          onClick={handleSignOut}
          className="flex items-center space-x-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          title="Sign out"
        >
          <LogOut className="h-3 w-3" />
          <span>Sign out</span>
        </button>
      )}
    </div>
  );
} 