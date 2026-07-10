/**
 * Test Credit Deduction System
 * This script tests if credits are properly deducted when processing queries
 */

const TEST_CONFIG = {
  serverUrl: 'http://localhost:3000',
  testQuery: 'What are the benefits of AI for research assistance?',
  // You need to get this from your browser after signing in
  // Instructions in the script below
  firebaseIdToken: 'YOUR_FIREBASE_ID_TOKEN_HERE'
};

async function testCreditDeduction() {
  console.log('🧪 Testing Credit Deduction System');
  console.log('==================================');
  
  try {
    // Check if token is provided
    if (TEST_CONFIG.firebaseIdToken === 'YOUR_FIREBASE_ID_TOKEN_HERE') {
      console.log('❌ Please update the firebaseIdToken in the script');
      console.log('📋 Instructions to get Firebase ID token:');
      console.log('1. Go to http://localhost:3000 and sign in');
      console.log('2. Press F12 to open Developer Tools');
      console.log('3. Go to Console tab');
      console.log('4. Run: firebase.auth().currentUser.getIdToken().then(token => console.log("Token:", token))');
      console.log('5. Copy the token and update TEST_CONFIG.firebaseIdToken in this script');
      return;
    }
    
    console.log('🔍 Testing authenticated query with credit deduction...');
    
    // Test the authenticated API call
    const response = await fetch(`${TEST_CONFIG.serverUrl}/api/user-query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TEST_CONFIG.firebaseIdToken}`
      },
      body: JSON.stringify({
        query: TEST_CONFIG.testQuery,
        context: 'This is a test query to verify credit deduction'
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
    console.log('✅ Query processed successfully!');
    console.log('📊 Query Results:');
    console.log(`  Success: ${data.success}`);
    console.log(`  Query: "${data.query}"`);
    console.log(`  Total Results: ${data.results?.length || 0}`);
    console.log(`  Total Cost: $${data.totalCost || 0}`);
    console.log(`  Processing Time: ${data.totalTime}ms`);
    
    // Check credit deduction
    if (data.userCredits) {
      console.log('💰 Credit Deduction Verification:');
      console.log(`  Credits Before: ${data.userCredits.before}`);
      console.log(`  Credits After: ${data.userCredits.after}`);
      console.log(`  Credits Deducted: ${data.userCredits.deducted}`);
      
      const expectedAfter = data.userCredits.before - data.userCredits.deducted;
      if (data.userCredits.after === expectedAfter) {
        console.log('✅ Credit deduction is working correctly!');
        console.log(`   Math check: ${data.userCredits.before} - ${data.userCredits.deducted} = ${data.userCredits.after}`);
      } else {
        console.log('❌ Credit deduction math is incorrect!');
        console.log(`   Expected: ${expectedAfter}, Got: ${data.userCredits.after}`);
      }
    } else {
      console.log('❌ No credit information in response');
    }
    
    if (data.results && data.results.length > 0) {
      console.log('🔍 Provider Results:');
      data.results.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.providerId.toUpperCase()}:`);
        console.log(`     Status: ${result.status}`);
        console.log(`     Response Time: ${result.responseTime}ms`);
        console.log(`     Cost: $${result.cost}`);
        if (result.error) {
          console.log(`     Error: ${result.error}`);
        }
      });
    }
    
    console.log('🎉 Credit deduction test completed successfully!');
    console.log('💡 To verify credits were actually deducted:');
    console.log('   1. Check your dashboard to see updated credit balance');
    console.log('   2. Run this test again to see credits decrease further');
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.log('🔧 TROUBLESHOOTING:');
    console.log('1. Make sure the Next.js server is running (npm run dev)');
    console.log('2. Check that the server is accessible');
    console.log('3. Verify your Firebase ID token is valid and not expired');
    console.log('4. Make sure you have enough credits (10 credits per query)');
    console.log('5. Check the server logs for detailed error information');
  }
}

// Run the test
testCreditDeduction(); 