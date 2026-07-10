'use client'
import React, { useState, useEffect } from 'react';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import Card from '@/components/shared/Card';
import WebLogo from '@/components/shared/WebLogo';
import { 
  CheckCircle, 
  XCircle, 
  AlertCircle,
  RefreshCw,
  Eye,
  Users,
  Database,
  Smartphone
} from 'lucide-react';

interface TestResult {
  id: string;
  name: string;
  status: 'pass' | 'fail' | 'warning' | 'running';
  message: string;
  details?: string;
}

export default function BrandContextTester(): React.ReactElement {
  const { user } = useAuthContext();
  const { 
    selectedBrand, 
    selectedBrandId, 
    brands, 
    setSelectedBrandId, 
    loading, 
    error 
  } = useBrandContext();

  const [tests, setTests] = useState<TestResult[]>([]);
  const [isRunning, setIsRunning] = useState(false);

  const runTests = async () => {
    setIsRunning(true);
    const newTests: TestResult[] = [];

    // Test 1: User Authentication
    newTests.push({
      id: 'auth',
      name: 'User Authentication',
      status: user ? 'pass' : 'fail',
      message: user ? `User authenticated: ${user.uid}` : 'User not authenticated',
      details: user ? `Email: ${user.email || 'No email'}` : undefined
    });

    // Test 2: Brand Context Provider
    newTests.push({
      id: 'provider',
      name: 'Brand Context Provider',
      status: typeof setSelectedBrandId === 'function' ? 'pass' : 'fail',
      message: typeof setSelectedBrandId === 'function' 
        ? 'BrandContext provider is working' 
        : 'BrandContext provider not found'
    });

    // Test 3: Brands Loading
    newTests.push({
      id: 'loading',
      name: 'Brands Loading State',
      status: loading ? 'warning' : 'pass',
      message: loading ? 'Brands are currently loading' : 'Brands loading completed',
      details: `Loading: ${loading}, Error: ${error || 'none'}`
    });

    // Test 4: Brands Data
    newTests.push({
      id: 'brands',
      name: 'Brands Data',
      status: brands.length > 0 ? 'pass' : 'warning',
      message: `Found ${brands.length} brand(s)`,
      details: brands.length > 0 
        ? `Brands: ${brands.map(b => b.companyName).join(', ')}` 
        : 'No brands found - add a brand to test selection'
    });

    // Test 5: Brand Selection
    newTests.push({
      id: 'selection',
      name: 'Brand Selection',
      status: selectedBrandId ? 'pass' : brands.length > 0 ? 'fail' : 'warning',
      message: selectedBrandId 
        ? `Selected brand: ${selectedBrand?.companyName || selectedBrandId}`
        : brands.length > 0 
          ? 'No brand selected despite brands being available'
          : 'No brands available for selection',
      details: selectedBrandId ? `Brand ID: ${selectedBrandId}` : undefined
    });

    // Test 6: localStorage Persistence
    const storedBrandId = localStorage.getItem('selectedBrandId');
    newTests.push({
      id: 'persistence',
      name: 'localStorage Persistence',
      status: storedBrandId ? 'pass' : 'warning',
      message: storedBrandId 
        ? `Brand selection persisted: ${storedBrandId}`
        : 'No brand selection stored (normal for new users)',
      details: `Stored value: ${storedBrandId || 'null'}`
    });

    // Test 7: Selected Brand Object
    if (selectedBrand) {
      const hasRequiredFields = !!(
        selectedBrand.id && 
        selectedBrand.companyName && 
        selectedBrand.domain
      );
      
      newTests.push({
        id: 'brandObject',
        name: 'Selected Brand Object',
        status: hasRequiredFields ? 'pass' : 'fail',
        message: hasRequiredFields 
          ? 'Selected brand has all required fields'
          : 'Selected brand missing required fields',
        details: `ID: ${selectedBrand.id}, Name: ${selectedBrand.companyName}, Domain: ${selectedBrand.domain}`
      });
    }

    setTests(newTests);
    setIsRunning(false);
  };

  useEffect(() => {
    // Run tests automatically when component mounts or context changes
    const timer = setTimeout(runTests, 500);
    return () => clearTimeout(timer);
  }, [user, brands, selectedBrand, loading, error]);

  const getStatusIcon = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'fail':
        return <XCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertCircle className="h-5 w-5 text-yellow-500" />;
      case 'running':
        return <RefreshCw className="h-5 w-5 text-blue-500 animate-spin" />;
    }
  };

  const getStatusColor = (status: TestResult['status']) => {
    switch (status) {
      case 'pass':
        return 'border-green-200 bg-green-50';
      case 'fail':
        return 'border-red-200 bg-red-50';
      case 'warning':
        return 'border-yellow-200 bg-yellow-50';
      case 'running':
        return 'border-blue-200 bg-blue-50';
    }
  };

  const passedTests = tests.filter(t => t.status === 'pass').length;
  const totalTests = tests.length;

  return (
    <Card>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-foreground">BrandContext Test Suite</h3>
            <p className="text-sm text-muted-foreground">
              Testing BrandContext functionality and integration
            </p>
          </div>
          <button
            onClick={runTests}
            disabled={isRunning}
            className="flex items-center space-x-2 bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 disabled:opacity-50 transition-colors"
          >
            <RefreshCw className={`h-4 w-4 ${isRunning ? 'animate-spin' : ''}`} />
            <span>Run Tests</span>
          </button>
        </div>

        {/* Test Results Summary */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center justify-center mb-1">
              <CheckCircle className="h-5 w-5 text-green-500" />
            </div>
            <p className="text-lg font-bold text-foreground">{passedTests}</p>
            <p className="text-xs text-muted-foreground">Passed</p>
          </div>
          
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center justify-center mb-1">
              <XCircle className="h-5 w-5 text-red-500" />
            </div>
            <p className="text-lg font-bold text-foreground">
              {tests.filter(t => t.status === 'fail').length}
            </p>
            <p className="text-xs text-muted-foreground">Failed</p>
          </div>
          
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center justify-center mb-1">
              <AlertCircle className="h-5 w-5 text-yellow-500" />
            </div>
            <p className="text-lg font-bold text-foreground">
              {tests.filter(t => t.status === 'warning').length}
            </p>
            <p className="text-xs text-muted-foreground">Warnings</p>
          </div>
          
          <div className="text-center p-3 bg-muted/20 rounded-lg">
            <div className="flex items-center justify-center mb-1">
              <Database className="h-5 w-5 text-blue-500" />
            </div>
            <p className="text-lg font-bold text-foreground">{totalTests}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>

        {/* Test Results */}
        <div className="space-y-3">
          <h4 className="font-medium text-foreground">Test Results</h4>
          {tests.map((test) => (
            <div 
              key={test.id} 
              className={`p-4 rounded-lg border ${getStatusColor(test.status)}`}
            >
              <div className="flex items-start space-x-3">
                {getStatusIcon(test.status)}
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <h5 className="font-medium text-foreground">{test.name}</h5>
                    <span className="text-xs text-muted-foreground uppercase">
                      {test.status}
                    </span>
                  </div>
                  <p className="text-sm text-foreground mt-1">{test.message}</p>
                  {test.details && (
                    <p className="text-xs text-muted-foreground mt-2 font-mono">
                      {test.details}
                    </p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Current Context State */}
        <div className="space-y-3">
          <h4 className="font-medium text-foreground">Current Context State</h4>
          <div className="bg-muted/20 rounded-lg p-4 space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Selected Brand ID
                </label>
                <p className="text-sm text-foreground font-mono">
                  {selectedBrandId || 'null'}
                </p>
              </div>
              
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Brands Count
                </label>
                <p className="text-sm text-foreground">
                  {brands.length} brand(s)
                </p>
              </div>
              
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Loading State
                </label>
                <p className="text-sm text-foreground">
                  {loading ? 'Loading...' : 'Ready'}
                </p>
              </div>
              
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase">
                  Error State
                </label>
                <p className="text-sm text-foreground">
                  {error || 'None'}
                </p>
              </div>
            </div>

            {selectedBrand && (
              <div className="pt-3 border-t border-border">
                <label className="text-xs font-medium text-muted-foreground uppercase mb-2 block">
                  Selected Brand Details
                </label>
                <div className="flex items-center space-x-3 p-3 bg-background rounded-lg border border-border">
                  <WebLogo domain={selectedBrand.domain} size={24} />
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {selectedBrand.companyName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {selectedBrand.domain}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Manual Test Actions */}
        {brands.length > 1 && (
          <div className="space-y-3">
            <h4 className="font-medium text-foreground">Manual Test Actions</h4>
            <div className="flex flex-wrap gap-2">
              {brands.map((brand) => (
                <button
                  key={brand.id}
                  onClick={() => setSelectedBrandId(brand.id)}
                  className={`px-3 py-2 rounded-lg border text-sm transition-colors ${
                    selectedBrandId === brand.id
                      ? 'bg-[#000C60] text-white border-[#000C60]'
                      : 'bg-background text-foreground border-border hover:bg-accent'
                  }`}
                >
                  Select {brand.companyName}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Click buttons above to test brand selection. Check if data updates and selection persists on page refresh.
            </p>
          </div>
        )}

        {/* Instructions */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-start space-x-2">
            <Smartphone className="h-5 w-5 text-blue-600 mt-0.5" />
            <div>
              <h5 className="font-medium text-blue-900">Testing Instructions</h5>
              <ul className="text-sm text-blue-800 mt-2 space-y-1">
                <li>1. Ensure you have brands added to your account</li>
                <li>2. Check that brand selection works in the sidebar</li>
                <li>3. Navigate between dashboard pages and verify brand selection persists</li>
                <li>4. Refresh the page and check if selection is maintained</li>
                <li>5. Check browser network tab for brand-specific API calls</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
} 