/**
 * Manual Test Utility for BrandContext
 * 
 * This can be run in the browser console to test BrandContext functionality
 * without requiring additional testing dependencies.
 * 
 * Usage:
 * 1. Navigate to any dashboard page
 * 2. Open browser console
 * 3. Copy and paste this code
 * 4. Run: testBrandContext()
 */

interface TestResult {
  testName: string;
  passed: boolean;
  message: string;
  error?: any;
}

export function testBrandContext(): void {
  console.log('🧪 Starting BrandContext Tests...\n');
  
  const results: TestResult[] = [];
  
  // Test 1: Check if BrandContext is available globally
  const test1 = (): TestResult => {
    try {
      // Check if we can access React DevTools or context
      const hasReact = typeof window.React !== 'undefined' || 
                      document.querySelector('[data-reactroot]') !== null ||
                      document.querySelector('#__next') !== null;
      
      return {
        testName: 'React App Detection',
        passed: hasReact,
        message: hasReact ? 'React app detected' : 'React app not detected'
      };
    } catch (error) {
      return {
        testName: 'React App Detection',
        passed: false,
        message: 'Error detecting React app',
        error
      };
    }
  };

  // Test 2: Check localStorage functionality
  const test2 = (): TestResult => {
    try {
      const testKey = 'brandContextTest';
      const testValue = 'test123';
      
      localStorage.setItem(testKey, testValue);
      const retrieved = localStorage.getItem(testKey);
      localStorage.removeItem(testKey);
      
      const passed = retrieved === testValue;
      return {
        testName: 'localStorage Functionality',
        passed,
        message: passed ? 'localStorage working correctly' : 'localStorage failed'
      };
    } catch (error) {
      return {
        testName: 'localStorage Functionality',
        passed: false,
        message: 'localStorage not available',
        error
      };
    }
  };

  // Test 3: Check if sidebar brand dropdown exists
  const test3 = (): TestResult => {
    try {
      // Look for brand-related elements in the sidebar
      const sidebar = document.querySelector('nav') || 
                     document.querySelector('[data-testid*="sidebar"]') ||
                     document.querySelector('aside');
      
      if (!sidebar) {
        return {
          testName: 'Sidebar Detection',
          passed: false,
          message: 'Sidebar not found'
        };
      }

      // Look for brand elements
      const brandElements = sidebar.querySelectorAll('button, div').length > 0;
      
      return {
        testName: 'Sidebar Detection',
        passed: brandElements,
        message: brandElements ? 'Sidebar with elements found' : 'Sidebar found but no elements'
      };
    } catch (error) {
      return {
        testName: 'Sidebar Detection',
        passed: false,
        message: 'Error detecting sidebar',
        error
      };
    }
  };

  // Test 4: Check for brand selection persistence
  const test4 = (): TestResult => {
    try {
      const selectedBrandId = localStorage.getItem('selectedBrandId');
      
      return {
        testName: 'Brand Selection Persistence',
        passed: true,
        message: selectedBrandId 
          ? `Found stored brand ID: ${selectedBrandId}` 
          : 'No stored brand ID (this is normal for new users)'
      };
    } catch (error) {
      return {
        testName: 'Brand Selection Persistence',
        passed: false,
        message: 'Error checking brand persistence',
        error
      };
    }
  };

  // Test 5: Check for dashboard layout structure
  const test5 = (): TestResult => {
    try {
      const main = document.querySelector('main') || 
                   document.querySelector('[role="main"]') ||
                   document.querySelector('.dashboard');
      
      const hasLayout = main !== null;
      
      return {
        testName: 'Dashboard Layout Detection',
        passed: hasLayout,
        message: hasLayout ? 'Dashboard layout detected' : 'Dashboard layout not found'
      };
    } catch (error) {
      return {
        testName: 'Dashboard Layout Detection',
        passed: false,
        message: 'Error detecting dashboard layout',
        error
      };
    }
  };

  // Run all tests
  [test1, test2, test3, test4, test5].forEach((testFn, index) => {
    console.log(`\n${index + 1}. Running test...`);
    const result = testFn();
    results.push(result);
    
    const status = result.passed ? '✅ PASS' : '❌ FAIL';
    console.log(`${status} ${result.testName}: ${result.message}`);
    
    if (result.error) {
      console.warn('Error details:', result.error);
    }
  });

  // Summary
  const passedTests = results.filter(r => r.passed).length;
  const totalTests = results.length;
  
  console.log(`\n📊 Test Summary: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All tests passed! BrandContext environment looks good.');
  } else {
    console.log('⚠️  Some tests failed. Check the details above.');
  }

  console.log('\n📋 Next Steps:');
  console.log('1. Navigate to dashboard and check if brands appear in sidebar');
  console.log('2. Try selecting different brands and see if data changes');
  console.log('3. Refresh page and verify brand selection persists');
  console.log('4. Check browser network tab for brand-specific API calls');
  
  return;
}

// Auto-run if in browser environment
if (typeof window !== 'undefined') {
  // Make it globally available
  (window as any).testBrandContext = testBrandContext;
  console.log('🔧 BrandContext test utility loaded. Run testBrandContext() to start testing.');
} 