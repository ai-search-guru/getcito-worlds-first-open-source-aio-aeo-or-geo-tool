// Test script for user query API with authentication and credit deduction
const fetch = require('node-fetch');

// Configuration
const BASE_URL = 'http://localhost:3000';
const API_ENDPOINT = '/api/user-query';

// Test Firebase ID token (you'll need to get this from your browser's dev tools)
// Instructions:
// 1. Open your browser dev tools (F12)
// 2. Go to Application/Storage tab
// 3. Find firebase:authUser in localStorage
// 4. Copy the 'stsTokenManager.accessToken' value
const FIREBASE_ID_TOKEN = 'YOUR_FIREBASE_ID_TOKEN_HERE';

async function testUserQueryWithAuth() {
  console.log('🧪 Testing User Query API with Authentication & Credit Deduction');
  console.log('================================================================');
  
  // Test query
  const testQuery = 'What are the latest trends in artificial intelligence for 2025?';
  
  console.log('📝 Test Query:', testQuery);
  console.log('💰 Expected Credit Cost: 10 credits');
  console.log('🔐 Using Firebase Authentication');
  console.log('');

  try {
    console.log('🔍 Trying to connect to server...');
    
    // First, test if server is running
    const healthCheck = await fetch(`${BASE_URL}/api/debug-providers`);
    if (!healthCheck.ok) {
      throw new Error(`Server not responding. Status: ${healthCheck.status}`);
    }
    console.log('✅ Server is running');
    
    // Check if we have a valid token
    if (FIREBASE_ID_TOKEN === 'YOUR_FIREBASE_ID_TOKEN_HERE') {
      console.log('❌ Please update the FIREBASE_ID_TOKEN in this script');
      console.log('');
      console.log('📋 Instructions to get your Firebase ID token:');
      console.log('1. Open your browser and go to http://localhost:3000');
      console.log('2. Sign in to your account');
      console.log('3. Open Developer Tools (F12)');
      console.log('4. Go to Application/Storage tab');
      console.log('5. Find "firebase:authUser" in localStorage');
      console.log('6. Copy the "stsTokenManager.accessToken" value');
      console.log('7. Replace FIREBASE_ID_TOKEN in this script');
      return;
    }

    console.log('🚀 Making authenticated request...');
    
    const startTime = Date.now();
    
    const response = await fetch(`${BASE_URL}${API_ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${FIREBASE_ID_TOKEN}`
      },
      body: JSON.stringify({
        query: testQuery,
        context: 'Focus on the most recent developments and trends'
      })
    });

    const endTime = Date.now();
    const totalTime = endTime - startTime;

    console.log('📊 Response Status:', response.status);
    console.log('⏱️  Total Time:', totalTime + 'ms');
    console.log('');

    const data = await response.json();

    if (response.ok) {
      console.log('✅ SUCCESS - Query processed with authentication!');
      console.log('================================================');
      console.log('');
      
      // Credit Information
      console.log('💰 CREDIT TRANSACTION:');
      console.log('  Credits Before:', data.userCredits?.before || 'Unknown');
      console.log('  Credits After:', data.userCredits?.after || 'Unknown');
      console.log('  Credits Deducted:', data.userCredits?.deducted || 'Unknown');
      console.log('');
      
      // Query Results
      console.log('📋 QUERY RESULTS:');
      console.log('  Query:', data.query);
      console.log('  Total Results:', data.totalResults);
      console.log('  Successful Results:', data.successfulResults);
      console.log('  Total Cost:', '$' + data.totalCost?.toFixed(4));
      console.log('  Processing Time:', data.totalTime + 'ms');
      console.log('');

      // Provider Summary
      console.log('🎯 PROVIDER SUMMARY:');
      if (data.summary?.chatgptSearch) {
        console.log('  🔍 ChatGPT Search:');
        console.log('    Content Length:', data.summary.chatgptSearch.content?.length || 0, 'characters');
        console.log('    Web Search Used:', data.summary.chatgptSearch.webSearchUsed ? 'Yes' : 'No');
        console.log('    Citations:', data.summary.chatgptSearch.citations || 0);
        console.log('    Response Time:', data.summary.chatgptSearch.responseTime + 'ms');
      }
      
      if (data.summary?.googleAiOverview) {
        console.log('  📊 Google AI Overview:');
        console.log('    Total Items:', data.summary.googleAiOverview.totalItems || 0);
        console.log('    People Also Ask:', data.summary.googleAiOverview.peopleAlsoAskCount || 0);
        console.log('    Organic Results:', data.summary.googleAiOverview.organicResultsCount || 0);
        console.log('    Response Time:', data.summary.googleAiOverview.responseTime + 'ms');
      }
      
      if (data.summary?.perplexity) {
        console.log('  🧠 Perplexity AI:');
        console.log('    Content Length:', data.summary.perplexity.content?.length || 0, 'characters');
        console.log('    Citations:', data.summary.perplexity.citations || 0);
        console.log('    Real-time Data:', data.summary.perplexity.realTimeData ? 'Yes' : 'No');
        console.log('    Response Time:', data.summary.perplexity.responseTime + 'ms');
      }
      console.log('');

      // Performance Analysis
      console.log('⚡ PERFORMANCE ANALYSIS:');
      const avgResponseTime = data.totalTime / 3;
      const successRate = (data.successfulResults / data.totalResults) * 100;
      console.log('  Average Response Time:', Math.round(avgResponseTime) + 'ms');
      console.log('  Success Rate:', successRate.toFixed(1) + '%');
      console.log('  Cost per Provider:', '$' + (data.totalCost / data.totalResults).toFixed(4));
      console.log('');

      // Sample Content Preview
      console.log('📝 CONTENT PREVIEW:');
      if (data.summary?.chatgptSearch?.content) {
        console.log('  ChatGPT Search Preview:');
        console.log('    ' + data.summary.chatgptSearch.content.substring(0, 200) + '...');
        console.log('');
      }
      if (data.summary?.perplexity?.content) {
        console.log('  Perplexity Preview:');
        console.log('    ' + data.summary.perplexity.content.substring(0, 200) + '...');
        console.log('');
      }

    } else {
      console.log('❌ ERROR - Query failed');
      console.log('=======================');
      console.log('');
      console.log('Error Details:');
      console.log('  Status:', response.status);
      console.log('  Message:', data.error || 'Unknown error');
      console.log('  Code:', data.code || 'Unknown');
      
      if (data.code === 'AUTHENTICATION_REQUIRED') {
        console.log('');
        console.log('🔐 Authentication Issue:');
        console.log('  Make sure you have updated the FIREBASE_ID_TOKEN in this script');
        console.log('  The token may have expired - get a fresh one from your browser');
      }
      
      if (data.code === 'INSUFFICIENT_CREDITS') {
        console.log('');
        console.log('💰 Credit Issue:');
        console.log('  Required Credits:', data.requiredCredits);
        console.log('  Available Credits:', data.availableCredits);
        console.log('  You need to add more credits to your account');
      }
    }

  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('');
    console.log('🔧 Troubleshooting:');
    console.log('  1. Make sure the Next.js server is running (npm run dev)');
    console.log('  2. Check that you have updated the FIREBASE_ID_TOKEN');
    console.log('  3. Verify your Firebase configuration is correct');
    console.log('  4. Check the server logs for more details');
  }
}

// Run the test
testUserQueryWithAuth(); 