// Test script for processing user queries through AI
// This script simulates what the client-side button does

const API_URL = 'http://localhost:3001/api/process-user-queries';

// Test brand data - you'll need to replace this with actual data
const TEST_BRAND = {
  id: 'test-brand-id', // Replace with actual brand ID
  companyName: 'Test Company',
  queries: [
    {
      query: 'What is Test Company?',
      keyword: 'brand awareness',
      category: 'Awareness'
    },
    {
      query: 'How does Test Company work?',
      keyword: 'product understanding',
      category: 'Interest'
    }
  ]
};

async function testProcessQueries() {
  console.log('🚀 Starting User Query Processing Test');
  console.log('📍 API URL:', API_URL);
  console.log('🏢 Brand:', TEST_BRAND.companyName);
  console.log('📝 Queries:', TEST_BRAND.queries.length);
  
  try {
    console.log('\n' + '='.repeat(60));
    console.log('📊 Processing queries...');
    console.log('='.repeat(60));
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        brandData: {
          id: TEST_BRAND.id,
          companyName: TEST_BRAND.companyName
        },
        queries: TEST_BRAND.queries
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Error:', data.error || 'Unknown error');
      console.error('Details:', data);
      return;
    }

    console.log('\n✅ Processing Complete!');
    console.log('\n📊 Summary:');
    console.log(`  - Total Queries: ${data.summary.totalQueries}`);
    console.log(`  - Processed Queries: ${data.summary.processedQueries}`);
    console.log(`  - Total Errors: ${data.summary.totalErrors}`);
    
    if (data.queryResults && data.queryResults.length > 0) {
      console.log('\n📋 Query Results:');
      data.queryResults.forEach((result, index) => {
        console.log(`\n${index + 1}. "${result.query}"`);
        console.log(`   Category: ${result.category}`);
        console.log(`   Keyword: ${result.keyword}`);
        
        if (result.results.chatgpt) {
          console.log(`   ✅ ChatGPT: ${result.results.chatgpt.response ? 'Response received' : 'Error'}`);
        }
        
        if (result.results.gemini) {
          console.log(`   ✅ Gemini: ${result.results.gemini.response ? 'Response received' : 'Error'}`);
        }
      });
    }
    
    if (data.errors && data.errors.length > 0) {
      console.log('\n⚠️  Errors:');
      data.errors.forEach(error => {
        console.log(`  - Query: "${error.query}"`);
        console.log(`    Error: ${error.error}`);
      });
    }
    
    console.log('\n💡 Note: The results are returned to the client.');
    console.log('   In the actual app, the client will save these to Firestore with proper auth.');
    
  } catch (error) {
    console.error('💥 Fatal Error:', error.message);
    console.error(error);
  }
}



console.log(`
📝 Instructions:
1. Make sure your dev server is running on port 3001
2. Update TEST_BRAND with actual brand data
3. To get brand data, you can:
   - Check the browser console when on the queries page
   - Or query Firestore directly

Current TEST_BRAND: ${TEST_BRAND.companyName}
`);

// Uncomment the line below to run the test
// testProcessQueries().catch(console.error); 