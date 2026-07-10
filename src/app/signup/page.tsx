'use client'
import React from "react";
import signUp from "@/firebase/auth/signup";
import googleSignIn from "@/firebase/auth/googleSignIn";
import { useRouter } from 'next/navigation';
import { useState } from "react";

function Page(): React.ReactElement {
  const [ email, setEmail ] = useState( '' );
  const [ password, setPassword ] = useState( '' );
  const [ isLoading, setIsLoading ] = useState( false );
  const [ isGoogleLoading, setIsGoogleLoading ] = useState( false );
  const [ error, setError ] = useState( '' );
  const router = useRouter();

  // Handle form submission
  const handleForm = async ( event: { preventDefault: () => void } ) => {
    event.preventDefault();
    
    setIsLoading( true );
    setError( '' ); // Clear any previous errors

    // Attempt to sign up with provided email and password
    const { result, error: signUpError } = await signUp( email, password );

    if ( signUpError ) {
      // Handle specific Firebase auth errors
      let errorMessage = 'An error occurred during sign up. Please try again.';
      
      const firebaseError = signUpError as any;
      if ( firebaseError.code === 'auth/email-already-in-use' ) {
        errorMessage = 'This email is already registered. Please use a different email or try signing in.';
      } else if ( firebaseError.code === 'auth/weak-password' ) {
        errorMessage = 'Password is too weak. Please choose a stronger password.';
      } else if ( firebaseError.code === 'auth/invalid-email' ) {
        errorMessage = 'Please enter a valid email address.';
      } else if ( firebaseError.code === 'auth/operation-not-allowed' ) {
        errorMessage = 'Email/password accounts are not enabled. Please contact support.';
      }
      
      setError( errorMessage );
      setIsLoading( false );
      return;
    }

    // Sign up successful
    console.log( result );

    // Redirect new users directly to brand setup (they will have 500 credits)
    router.push( "/dashboard/add-brand/step-1" );
  }

  // Handle Google sign-in
  const handleGoogleSignIn = async () => {
    setIsGoogleLoading( true );
    setError( '' ); // Clear any previous errors

    const { result, error: googleError } = await googleSignIn();

    if ( googleError ) {
      let errorMessage = 'An error occurred with Google sign-in. Please try again.';
      
      const firebaseError = googleError as any;
      if ( firebaseError.code === 'auth/popup-closed-by-user' ) {
        errorMessage = 'Sign-in was cancelled. Please try again.';
      } else if ( firebaseError.code === 'auth/popup-blocked' ) {
        errorMessage = 'Pop-up was blocked by your browser. Please allow pop-ups and try again.';
      }
      
      setError( errorMessage );
      setIsGoogleLoading( false );
      return;
    }

    console.log( result );
    // Redirect new users directly to brand setup (they will have 500 credits)
    router.push( "/dashboard/add-brand/step-1" );
  }

  return (
    <div className="flex justify-center items-center h-screen text-black">
      <div className="w-96 bg-white rounded shadow p-6">
        <h1 className="text-3xl font-bold mb-6">Registration</h1>
        
        {/* Error Message */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-600 text-sm flex items-center">
              <svg className="w-4 h-4 mr-2 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          </div>
        )}
        
        <form onSubmit={handleForm} className="space-y-4">
          <div>
            <label htmlFor="email" className="block mb-1 font-medium">
              Email
            </label>
            <input
              onChange={( e ) => {
                setEmail( e.target.value );
                if ( error ) setError( '' ); // Clear error when user starts typing
              }}
              required
              type="email"
              name="email"
              id="email"
              placeholder="example@mail.com"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <div>
            <label htmlFor="password" className="block mb-1 font-medium">
              Password
            </label>
            <input
              onChange={( e ) => {
                setPassword( e.target.value );
                if ( error ) setError( '' ); // Clear error when user starts typing
              }}
              required
              type="password"
              name="password"
              id="password"
              placeholder="password"
              className="w-full border border-gray-300 rounded px-3 py-2"
            />
          </div>
          <button
            type="submit"
            disabled={isLoading || isGoogleLoading}
            className={`w-full font-semibold py-2 rounded flex items-center justify-center ${
              isLoading 
                ? 'bg-gray-400 cursor-not-allowed' 
                : 'bg-blue-500 hover:bg-blue-600'
            } text-white`}
          >
            {isLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Signing Up...
              </>
            ) : (
              'Sign up'
            )}
          </button>
          
          <div className="flex items-center my-4">
            <div className="flex-1 border-t border-gray-300"></div>
            <span className="px-3 text-gray-500 text-sm">or</span>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>
          
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isLoading || isGoogleLoading}
            className={`w-full font-semibold py-2 px-4 rounded flex items-center justify-center border ${
              isGoogleLoading 
                ? 'bg-gray-100 cursor-not-allowed border-gray-300' 
                : 'bg-white hover:bg-gray-50 border-gray-300'
            } text-gray-700`}
          >
            {isGoogleLoading ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600 mr-2"></div>
                Signing up with Google...
              </>
            ) : (
              <>
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>
        </form>
        {/* Add this below the signup form */}
        <div className="mt-4 text-center text-sm text-gray-600 dark:text-gray-300">
          Already have an account?{' '}
          <a href="/signin" className="text-[#000C60] hover:underline">Login</a>
        </div>
      </div>
    </div>
  );
}

export default Page;
