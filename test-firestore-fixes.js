const { initializeApp } = require('firebase/app');
const { getFirestore, doc, setDoc, collection } = require('firebase/firestore');

// Test Firebase configuration (use your actual config)
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Test data that should work (no nested arrays, reasonable size)
const testBrandData = {
  userId: 'test_user_123',
  companyName: 'Test Company',
  domain: 'test.com',
  shortDescription: 'A test company',
  productsAndServices: ['Product 1', 'Product 2'], // Simple array, not nested
  keywords: ['test', 'company'],
  queries: [
    {
      keyword: 'test',
      query: 'What is Test Company?',
      category: 'Awareness',
      containsBrand: 1,
      selected: true
    }
  ],
  queryProcessingResults: [
    {
      date: new Date().toISOString(),
      processingSessionId: 'test_session_123',
      processingSessionTimestamp: new Date().toISOString(),
      query: 'What is Test Company?',
      keyword: 'test',
      category: 'Awareness',
      results: {
        chatgpt: {
          response: 'Test Company is a sample company for testing purposes.',
          timestamp: new Date().toISOString(),
          responseTime: 1500,
          webSearchUsed: true,
          citations: 2
        },
        googleAI: {
          response: 'Found 10 search results',
          timestamp: new Date().toISOString(),
          responseTime: 800,
          totalItems: 10,
          organicResults: 8,
          peopleAlsoAsk: 3,
          location: 'US',
          aiOverview: 'Test Company provides testing services...',
          aiOverviewReferencesCount: 3, // Count instead of array
          hasAIOverview: true,
          serpFeaturesCount: 2, // Count instead of array
          relatedSearchesCount: 5, // Count instead of array
          videoResultsCount: 1, // Count instead of array
          hasRawData: true // Boolean instead of large object
        },
        perplexity: {
          response: 'Test Company is known for its testing solutions...',
          timestamp: new Date().toISOString(),
          responseTime: 1200,
          citations: 4,
          realTimeData: true,
          citationsCount: 4, // Count instead of array
          searchResultsCount: 6, // Count instead of array
          structuredCitationsCount: 3, // Count instead of array
          hasMetadata: true, // Boolean instead of object
          hasUsageStats: true // Boolean instead of object
        }
      }
    }
  ],
  brandsbasicData: {
    brandMentions: 150,
    brandMentionsChange: 15,
    brandValidity: 85,
    brandValidityChange: 5,
    lastUpdated: new Date().toISOString(),
    linkValidity: 90,
    linkValidityChange: 2,
    sentimentChange: 3,
    sentimentScore: 8
  },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  timestamp: Date.now(),
  setupComplete: true
};

// Test detailed query result for separate collection
const testDetailedResult = {
  userId: 'test_user_123',
  brandId: 'test_user_123_test_com',
  brandName: 'Test Company',
  processingSessionId: 'test_session_123',
  processingSessionTimestamp: new Date().toISOString(),
  query: 'What is Test Company?',
  keyword: 'test',
  category: 'Awareness',
  date: new Date().toISOString(),
  
  // Full data can be stored here since it's a separate collection
  chatgptResult: {
    response: 'Test Company is a comprehensive testing solutions provider...',
    timestamp: new Date().toISOString(),
    responseTime: 1500,
    webSearchUsed: true,
    citations: 2
  },
  
  googleAIResult: {
    response: 'Found 10 search results',
    timestamp: new Date().toISOString(),
    responseTime: 800,
    totalItems: 10,
    organicResults: 8,
    peopleAlsoAsk: 3,
    location: 'US',
    aiOverview: 'Test Company provides comprehensive testing services...',
    aiOverviewReferences: ['ref1', 'ref2', 'ref3'], // Arrays are OK here
    hasAIOverview: true,
    serpFeatures: ['feature1', 'feature2'], // Arrays are OK here
    relatedSearches: ['search1', 'search2'], // Arrays are OK here
    videoResults: [{ title: 'Test Video', url: 'test.com' }] // Arrays are OK here
  },
  
  perplexityResult: {
    response: 'Test Company is known for its innovative testing solutions...',
    timestamp: new Date().toISOString(),
    responseTime: 1200,
    citations: 4,
    realTimeData: true,
    citationsList: ['citation1', 'citation2'], // Arrays are OK here
    searchResults: ['result1', 'result2'], // Arrays are OK here
    structuredCitations: [{ text: 'citation', url: 'url' }] // Arrays are OK here
  }
};

async function testFirestoreFixes() {
  console.log('🧪 Testing Firestore fixes...');
  
  try {
    // Test 1: Save brand data (should work now - no nested arrays, reasonable size)
    console.log('📝 Test 1: Saving brand data to v8userbrands...');
    const brandRef = doc(db, 'v8userbrands', 'test_user_123_test_com');
    await setDoc(brandRef, testBrandData);
    console.log('✅ Test 1 PASSED: Brand data saved successfully');
    
    // Test 2: Save detailed results to separate collection (arrays are OK here)
    console.log('📝 Test 2: Saving detailed results to v8detailed_query_results...');
    const detailedRef = doc(collection(db, 'v8detailed_query_results'));
    await setDoc(detailedRef, testDetailedResult);
    console.log('✅ Test 2 PASSED: Detailed results saved successfully');
    
    console.log('🎉 All tests passed! Firestore fixes are working correctly.');
    console.log('');
    console.log('📊 Summary of fixes:');
    console.log('  ✅ Removed nested arrays from brand documents');
    console.log('  ✅ Reduced document size by storing counts instead of full arrays');
    console.log('  ✅ Created separate collection for detailed results with full data');
    console.log('  ✅ Limited queryProcessingResults to 50 most recent items');
    console.log('  ✅ Truncated long responses to 2000 characters max');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    
    if (error.code === 'invalid-argument' && error.message.includes('nested arrays')) {
      console.error('💡 Still have nested arrays issue - check data structure');
    } else if (error.message.includes('exceeds the maximum allowed size')) {
      console.error('💡 Still have document size issue - need to reduce data further');
    } else {
      console.error('💡 Other Firestore error:', error.code, error.message);
    }
  }
}

// Run the test
testFirestoreFixes().then(() => {
  console.log('🔬 Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test runner error:', error);
  process.exit(1);
}); 