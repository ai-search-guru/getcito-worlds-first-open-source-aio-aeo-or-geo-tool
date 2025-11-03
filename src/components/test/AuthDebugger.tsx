'use client'
import React, { useState } from 'react';
import { useAuthContext } from '@/context/AuthContext';
import { getFirebaseIdTokenWithRetry } from '@/utils/getFirebaseToken';

export default function AuthDebugger() {
  const { user, userProfile } = useAuthContext();
  const [tokenInfo, setTokenInfo] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const testGetToken = async () => {
    setLoading(true);
    try {
      console.log('🔑 Testing Firebase ID token retrieval...');
      const token = await getFirebaseIdTokenWithRetry(3, 1000);
      
      if (token) {
        // Decode the token to show some info (without sensitive data)
        const tokenParts = token.split('.');
        const payload = JSON.parse(atob(tokenParts[1]));
        
        setTokenInfo({
          hasToken: true,
          tokenLength: token.length,
          userId: payload.user_id,
          email: payload.email,
          exp: new Date(payload.exp * 1000).toISOString(),
          iat: new Date(payload.iat * 1000).toISOString(),
          aud: payload.aud,
          iss: payload.iss
        });
        
        console.log('✅ Token retrieved successfully');
      } else {
        setTokenInfo({ hasToken: false, error: 'No token retrieved' });
        console.log('❌ No token retrieved');
      }
    } catch (error) {
      console.error('❌ Error getting token:', error);
      setTokenInfo({ hasToken: false, error: error.message });
    } finally {
      setLoading(false);
    }
  };

  const testApiCall = async () => {
    setLoading(true);
    try {
      console.log('🚀 Testing authenticated API call...');
      const token = await getFirebaseIdTokenWithRetry(3, 1000);
      
      if (!token) {
        console.log('❌ No token available');
        return;
      }
      
      const response = await fetch('/api/user-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          query: 'Test authentication query',
          context: 'This is a test query for authentication debugging'
        })
      });
      
      console.log(`📡 API Response Status: ${response.status}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.log('❌ API Error:', errorText);
      } else {
        const data = await response.json();
        console.log('✅ API Success:', data);
      }
      
    } catch (error) {
      console.error('❌ API test failed:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-lg max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-4">🔐 Authentication Debugger</h2>
      
      <div className="space-y-4">
        {/* User Info */}
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-semibold mb-2">👤 User Information</h3>
          <div className="text-sm space-y-1">
            <p><strong>Authenticated:</strong> {user ? '✅ Yes' : '❌ No'}</p>
            {user && (
              <>
                <p><strong>UID:</strong> {user.uid}</p>
                <p><strong>Email:</strong> {user.email}</p>
                <p><strong>Display Name:</strong> {user.displayName || 'Not set'}</p>
              </>
            )}
          </div>
        </div>

        {/* User Profile */}
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-semibold mb-2">👤 User Profile</h3>
          <div className="text-sm space-y-1">
            <p><strong>Profile Loaded:</strong> {userProfile ? '✅ Yes' : '❌ No'}</p>
            {userProfile && (
              <>
                <p><strong>Credits:</strong> {userProfile.credits}</p>
                <p><strong>Created:</strong> {userProfile.createdAt}</p>
                <p><strong>Last Login:</strong> {userProfile.lastLoginAt}</p>
              </>
            )}
          </div>
        </div>

        {/* Token Test */}
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-semibold mb-2">🔑 Firebase ID Token</h3>
          <button
            onClick={testGetToken}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test Token Retrieval'}
          </button>
          
          {tokenInfo && (
            <div className="mt-3 text-sm">
              {tokenInfo.hasToken ? (
                <div className="text-green-600">
                  <p>✅ Token retrieved successfully</p>
                  <p>Length: {tokenInfo.tokenLength} characters</p>
                  <p>User ID: {tokenInfo.userId}</p>
                  <p>Email: {tokenInfo.email}</p>
                  <p>Expires: {tokenInfo.exp}</p>
                  <p>Issued: {tokenInfo.iat}</p>
                </div>
              ) : (
                <div className="text-red-600">
                  <p>❌ Failed to get token</p>
                  <p>Error: {tokenInfo.error}</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* API Test */}
        <div className="bg-gray-50 p-4 rounded">
          <h3 className="font-semibold mb-2">🚀 API Call Test</h3>
          <button
            onClick={testApiCall}
            disabled={loading || !user}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 disabled:opacity-50"
          >
            {loading ? 'Testing...' : 'Test API Call'}
          </button>
          <p className="text-sm text-gray-600 mt-2">
            This will test an authenticated API call to the user-query endpoint
          </p>
        </div>

        {/* Instructions */}
        <div className="bg-blue-50 p-4 rounded">
          <h3 className="font-semibold mb-2">📋 Instructions</h3>
          <div className="text-sm space-y-1">
            <p>1. Make sure you're signed in</p>
            <p>2. Test token retrieval first</p>
            <p>3. Then test the API call</p>
            <p>4. Check browser console for detailed logs</p>
          </div>
        </div>
      </div>
    </div>
  );
} 