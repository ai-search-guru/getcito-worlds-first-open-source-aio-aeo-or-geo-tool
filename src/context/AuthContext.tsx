'use client'
import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { getAuth, onAuthStateChanged, User } from 'firebase/auth';
import firebase_app from '@/firebase/config';
import { createUserProfile, getUserProfile, UserProfile } from '@/firebase/firestore/userProfile';

// Initialize Firebase auth instance
const auth = getAuth( firebase_app );

// Create the authentication context with proper typing
interface AuthContextType {
  user: User | null;
  userProfile: UserProfile | null;
  loading: boolean;
  refreshUserProfile: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextType>({ 
  user: null, 
  userProfile: null, 
  loading: true,
  refreshUserProfile: async () => {}
});

// Custom hook to access the authentication context
export const useAuthContext = () => useContext( AuthContext );

interface AuthContextProviderProps {
  children: ReactNode;
}

export function AuthContextProvider( { children }: AuthContextProviderProps ): React.ReactElement {
  // Set up state to track the authenticated user and loading status
  const [ user, setUser ] = useState<User | null>( null );
  const [ userProfile, setUserProfile ] = useState<UserProfile | null>( null );
  const [ loading, setLoading ] = useState( true );
  const [ isClient, setIsClient ] = useState( false );

  // Function to refresh user profile data
  const refreshUserProfile = async () => {
    if (user) {
      const { result, error } = await getUserProfile(user.uid);
      if (result && !error) {
        setUserProfile(result);
      }
    }
  };

  // Function to handle user authentication state changes
  const handleAuthStateChange = async (user: User | null) => {
    if (user) {
      // User is signed in - load/create their profile
      setUser(user);
      
      try {
        // Check if user profile exists, create if new user
        const { result: existingProfile } = await getUserProfile(user.uid);
        
        if (!existingProfile) {
          // New user - create profile with 500 credits
          const { result: newProfile, error } = await createUserProfile(user, true);
          if (newProfile && !error) {
            setUserProfile(newProfile);
            console.log('🎉 New user profile created with 500 credits');
          }
        } else {
          // Existing user - update their profile info and load credits
          const { result: updatedProfile, error } = await createUserProfile(user, false);
          if (updatedProfile && !error) {
            setUserProfile(updatedProfile);
            console.log('👤 User profile loaded with', updatedProfile.credits, 'credits');
          }
        }
      } catch (error) {
        console.error('❌ Error handling user profile:', error);
      }
    } else {
      // User is signed out
      setUser(null);
      setUserProfile(null);
    }
    
    // Set loading to false once authentication state is determined
    setLoading(false);
  };

  useEffect( () => {
    // Mark as client-side to prevent hydration mismatch
    setIsClient( true );
    
    // Subscribe to the authentication state changes
    const unsubscribe = onAuthStateChanged( auth, handleAuthStateChange );

    // Unsubscribe from the authentication state changes when the component is unmounted
    return () => unsubscribe();
  }, [] );

  // Prevent hydration mismatch by rendering same content on server and client initially
  if ( !isClient ) {
    return (
      <AuthContext.Provider value={{ user: null, userProfile: null, loading: true, refreshUserProfile: async () => {} }}>
        {children}
      </AuthContext.Provider>
    );
  }

  // Provide the authentication context to child components
  return (
    <AuthContext.Provider value={{ user, userProfile, loading, refreshUserProfile }}>
      {loading ? <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground">Loading...</div>
      </div> : children}
    </AuthContext.Provider>
  );
}
