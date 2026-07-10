/**
 * Test Authentication Flow
 * This script tests the authentication flow for the user-query API
 */

// Test configuration
const TEST_CONFIG = {
  serverUrl: 'http://localhost:3001',
  testQuery: 'What are the latest trends in AI for 2025?',
  // You need to get this from your browser after signing in
  // Instructions:
  // 1. Go to http://localhost:3001 and sign in
  // 2. Press F12 to open Developer Tools
  // 3. Go to Application/Storage tab
  // 4. Find "firebase:authUser" in localStorage
  // 5. Copy the "stsTokenManager.accessToken" value
  firebaseIdToken: 'YOUR_FIREBASE_ID_TOKEN_HERE'
};

async function testAuthenticatedQuery() {
  console.log('🧪 Testing Authenticated User Query API');
  console.log('======================================');
  
  try {
    // Check if token is provided
    if (TEST_CONFIG.firebaseIdToken === 'YOUR_FIREBASE_ID_TOKEN_HERE') {
      console.log('❌ Please update the firebaseIdToken in the script');
      console.log('📋 Instructions to get Firebase ID token:');
      console.log('1. Go to http://localhost:3001 and sign in');
      console.log('2. Press F12 to open Developer Tools');
      console.log('3. Go to Application/Storage tab');
      console.log('4. Find "firebase:authUser" in localStorage');
      console.log('5. Copy the "stsTokenManager.accessToken" value');
      console.log('6. Update TEST_CONFIG.firebaseIdToken in this script');
      return;
    }
    
    console.log('🔍 Testing server connection...');
    
    // Test the authenticated API call
    const response = await fetch(`${TEST_CONFIG.serverUrl}/api/user-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_CONFIG.firebaseIdToken}`
      },
      body: JSON.stringify({
        query: TEST_CONFIG.testQuery,
        context: 'This is a test query for authentication verification'
      })
    });
    
    console.log(`📡 Response Status: ${response.status}`);
    console.log(`📡 Response Status Text: ${response.statusText}`);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.log('❌ API Error Response:', errorText);
      
      try {
        const errorData = JSON.parse(errorText);
        console.log('🔍 Error Details:');
        console.log(`  Code: ${errorData.code}`);
        console.log(`  Message: ${errorData.error}`);
        
        if (errorData.code === 'AUTHENTICATION_REQUIRED') {
          console.log('💡 SOLUTION: Your Firebase ID token may be expired or invalid');
          console.log('   Please get a fresh token from your browser and update the script');
        } else if (errorData.code === 'INSUFFICIENT_CREDITS') {
          console.log('💡 SOLUTION: You need more credits to process queries');
          console.log(`   Required: ${errorData.requiredCredits}, Available: ${errorData.availableCredits}`);
        }
      } catch (parseError) {
        console.log('❌ Could not parse error response');
      }
      
      return;
    }
    
    // Parse successful response
    const data = await response.json();
    console.log('✅ Authentication successful!');
    console.log('📊 Query Results:');
    console.log(`  Success: ${data.success}`);
    console.log(`  Query: "${data.query}"`);
    console.log(`  Total Results: ${data.results?.length || 0}`);
    console.log(`  Total Cost: $${data.totalCost || 0}`);
    
    if (data.userCredits) {
      console.log('💰 Credit Information:');
      console.log(`  Credits Before: ${data.userCredits.before}`);
      console.log(`  Credits After: ${data.userCredits.after}`);
      console.log(`  Credits Deducted: ${data.userCredits.deducted}`);
    }
    
    if (data.results && data.results.length > 0) {
      console.log('🔍 Provider Results:');
      data.results.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.providerId.toUpperCase()}:`);
        console.log(`     Status: ${result.status}`);
        console.log(`     Response Time: ${result.responseTime}ms`);
        if (result.error) {
          console.log(`     Error: ${result.error}`);
        }
      });
    }
    
    console.log('🎉 Authentication test completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.log('🔧 TROUBLESHOOTING:');
    console.log('1. Make sure the Next.js server is running (npm run dev)');
    console.log('2. Check that the server is running on port 3001');
    console.log('3. Verify your Firebase ID token is valid and not expired');
    console.log('4. Make sure you have enough credits (10 credits per query)');
  }
}

// Run the test
testAuthenticatedQuery(); 