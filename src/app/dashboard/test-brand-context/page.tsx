'use client'
import React from 'react';
import { BrandContextProvider } from '@/context/BrandContext';
import { ThemeProvider } from '@/context/ThemeContext';
import BrandContextTester from '@/components/test/BrandContextTester';
import { AlertTriangle, ArrowLeft, Database } from 'lucide-react';
import Link from 'next/link';
import { useAuthContext } from '@/context/AuthContext';

// New component to display brandsbasicData
function BrandsBasicDataViewer(): React.ReactElement {
  const [brandsData, setBrandsData] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  
  // Use AuthContext for proper authentication
  const { user } = useAuthContext();

  const fetchBrandsData = async () => {
    setLoading(true);
    setError(null);
    
    try {
      // Check if user is authenticated via AuthContext
      if (!user || !user.uid) {
        setError('User not authenticated. Please sign in first.');
        return;
      }

      console.log('Authenticated user from context:', user.uid);
      console.log('User email:', user.email);
      
      // Import Firebase modules dynamically to ensure client-side execution
      const { getFirestore, collection, query, where, getDocs } = await import('firebase/firestore');
      const firebase_app = (await import('@/firebase/config')).default;
      
      const db = getFirestore(firebase_app);
      
      // Create Firestore query with authenticated user
      const brandsRef = collection(db, 'v8userbrands');
      const q = query(brandsRef, where('userId', '==', user.uid));
      
      console.log('Executing Firestore query for userId:', user.uid);
      console.log('Collection: v8userbrands');
      
      const querySnapshot = await getDocs(q);
      console.log('Query completed. Documents found:', querySnapshot.size);
      
      const brands = querySnapshot.docs.map(doc => {
        const data = doc.data();
        console.log('Document ID:', doc.id);
        console.log('Document data:', data);
        return {
          id: doc.id,
          ...data
        };
      });
      
      setBrandsData(brands);
      console.log('Final brands data set:', brands);
      console.log('Number of brands found:', brands.length);
      
    } catch (err) {
      console.error('Error fetching brands data:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-2">
          <Database className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-900">Brands Basic Data Viewer</h3>
        </div>
        <button
          onClick={fetchBrandsData}
          disabled={loading}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Loading...' : 'Fetch Data'}
        </button>
      </div>
      
      {/* Authentication Status */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-blue-900">Authentication Status:</span>
          <span className={`px-2 py-1 rounded text-xs font-medium ${
            user ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
          }`}>
            {user ? `✅ Authenticated as ${user.email}` : '❌ Not authenticated'}
          </span>
        </div>
        {user && (
          <div className="mt-2 text-xs text-blue-700">
            <strong>User ID:</strong> <code className="bg-blue-100 px-1 rounded">{user.uid}</code>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700">
          <strong>Error:</strong> {error}
        </div>
      )}
      
      {brandsData.length > 0 && (
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Found {brandsData.length} brand(s) in v8userbrands collection
          </p>
          
          {brandsData.map((brand, index) => (
            <div key={brand.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-medium text-gray-900">
                  {brand.companyName || 'Unknown Company'}
                </h4>
                <span className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded">
                  ID: {brand.id}
                </span>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Domain</label>
                  <p className="text-sm text-gray-900">{brand.domain || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">User ID</label>
                  <p className="text-sm text-gray-900 font-mono">{brand.userId || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Created At</label>
                  <p className="text-sm text-gray-900">
                    {brand.createdAt ? new Date(brand.createdAt).toLocaleString() : 'N/A'}
                  </p>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-500 uppercase">Setup Complete</label>
                  <p className="text-sm text-gray-900">
                    {brand.setupComplete ? '✅ Yes' : '❌ No'}
                  </p>
                </div>
              </div>
              
              {/* brandsbasicData Section */}
              <div className="border-t border-gray-300 pt-4">
                <h5 className="font-medium text-gray-900 mb-3 flex items-center">
                  <Database className="h-4 w-4 mr-2" />
                  brandsbasicData
                </h5>
                
                {brand.brandsbasicData ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div className="bg-white p-3 rounded border">
                      <label className="text-xs font-medium text-gray-500 uppercase">Brand Mentions</label>
                      <p className="text-lg font-bold text-blue-600">
                        {brand.brandsbasicData.brandMentions}
                      </p>
                      <p className="text-xs text-gray-500">
                        Change: {brand.brandsbasicData.brandMentionsChange > 0 ? '+' : ''}{brand.brandsbasicData.brandMentionsChange}
                      </p>
                    </div>
                    
                    <div className="bg-white p-3 rounded border">
                      <label className="text-xs font-medium text-gray-500 uppercase">Brand Validity</label>
                      <p className="text-lg font-bold text-green-600">
                        {brand.brandsbasicData.brandValidity}%
                      </p>
                      <p className="text-xs text-gray-500">
                        Change: {brand.brandsbasicData.brandValidityChange > 0 ? '+' : ''}{brand.brandsbasicData.brandValidityChange}%
                      </p>
                    </div>
                    
                    <div className="bg-white p-3 rounded border">
                      <label className="text-xs font-medium text-gray-500 uppercase">Link Validity</label>
                      <p className="text-lg font-bold text-purple-600">
                        {brand.brandsbasicData.linkValidity}%
                      </p>
                      <p className="text-xs text-gray-500">
                        Change: {brand.brandsbasicData.linkValidityChange > 0 ? '+' : ''}{brand.brandsbasicData.linkValidityChange}%
                      </p>
                    </div>
                    
                    <div className="bg-white p-3 rounded border">
                      <label className="text-xs font-medium text-gray-500 uppercase">Sentiment Score</label>
                      <p className="text-lg font-bold text-orange-600">
                        {brand.brandsbasicData.sentimentScore}/10
                      </p>
                      <p className="text-xs text-gray-500">
                        Change: {brand.brandsbasicData.sentimentChange > 0 ? '+' : ''}{brand.brandsbasicData.sentimentChange}
                      </p>
                    </div>
                    
                    <div className="bg-white p-3 rounded border col-span-1 md:col-span-2">
                      <label className="text-xs font-medium text-gray-500 uppercase">Last Updated</label>
                      <p className="text-sm text-gray-900">
                        {brand.brandsbasicData.lastUpdated ? 
                          new Date(brand.brandsbasicData.lastUpdated).toLocaleString() : 
                          'N/A'
                        }
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                    <p className="text-yellow-800 text-sm">
                      ⚠️ No brandsbasicData found for this brand. 
                      This data is generated when you complete the brand setup process.
                    </p>
                  </div>
                )}
              </div>
              
              {/* Raw Data Section (Collapsible) */}
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-gray-700 hover:text-gray-900">
                  Show Raw Data
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-3 rounded overflow-x-auto">
                  {JSON.stringify(brand, null, 2)}
                </pre>
              </details>
            </div>
          ))}
        </div>
      )}
      
      {brandsData.length === 0 && !loading && !error && (
        <div className="text-center py-8 text-gray-500">
          <Database className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No data loaded yet. Click "Fetch Data" to load brands from Firestore.</p>
        </div>
      )}
    </div>
  );
}

function TestPageContent(): React.ReactElement {
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Back Button */}
        <div className="flex items-center space-x-4">
          <Link 
            href="/dashboard" 
            className="flex items-center space-x-2 text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Back to Dashboard</span>
          </Link>
        </div>

        {/* Page Header */}
        <div>
          <h1 className="text-3xl font-bold text-foreground mb-2">BrandContext Test Suite</h1>
          <p className="text-muted-foreground">
            Test and verify BrandContext functionality
          </p>
        </div>

        {/* Warning Message */}
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600 mt-0.5" />
            <div>
              <h3 className="font-medium text-yellow-900">Development Testing Page</h3>
              <p className="text-sm text-yellow-800 mt-1">
                This page is for testing BrandContext functionality. Remove this page in production.
              </p>
            </div>
          </div>
        </div>

        {/* Brands Basic Data Viewer */}
        <BrandsBasicDataViewer />

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <h2 className="text-lg font-semibold text-blue-900 mb-3">
            How to Test BrandContext
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm text-blue-800">
            <div>
              <h4 className="font-medium mb-2">Prerequisites:</h4>
              <ul className="space-y-1">
                <li>• User must be authenticated</li>
                <li>• At least one brand should be added</li>
                <li>• Multiple brands for selection testing</li>
              </ul>
            </div>
            <div>
              <h4 className="font-medium mb-2">Test Scenarios:</h4>
              <ul className="space-y-1">
                <li>• Brand auto-selection on load</li>
                <li>• Manual brand selection</li>
                <li>• localStorage persistence</li>
                <li>• Context state management</li>
              </ul>
            </div>
          </div>
        </div>

        {/* Brand Context Tester Component */}
        <BrandContextTester />

        {/* Additional Information */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
          <h3 className="font-medium text-gray-900 mb-3">Additional Testing Options</h3>
          <div className="space-y-4 text-sm text-gray-700">
            <div>
              <h4 className="font-medium text-gray-900">Console Testing:</h4>
              <p>Open browser console and run manual tests:</p>
              <code className="block bg-gray-100 p-2 rounded mt-1 font-mono text-xs">
                testBrandContext()
              </code>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900">Network Monitoring:</h4>
              <p>
                Open Network tab in DevTools and verify that API calls include the correct brandId parameter 
                when brands are selected.
              </p>
            </div>
            
            <div>
              <h4 className="font-medium text-gray-900">localStorage Inspection:</h4>
              <p>
                Check Application → Local Storage in DevTools for 'selectedBrandId' key persistence.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TestBrandContextPage(): React.ReactElement {
  return (
    <ThemeProvider>
      <BrandContextProvider>
        <TestPageContent />
      </BrandContextProvider>
    </ThemeProvider>
  );
} 