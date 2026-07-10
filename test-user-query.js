// Test script for the user-query API endpoint

const API_URL = 'http://localhost:3001/api/user-query';

// Test queries
const testQueries = [
  {
    query: "What are the benefits of using AI in customer service?",
    provider: "both",
    context: "Please provide a concise answer focusing on practical benefits."
  },
  {
    query: "Explain quantum computing in simple terms",
    provider: "openai"
  },
  {
    query: "What are the latest trends in web development for 2024?",
    provider: "gemini"
  },
  {
    query: "Compare React and Vue.js frameworks",
    provider: "both",
    context: "Focus on performance, learning curve, and ecosystem."
  }
];

// Function to test a single query
async function testQuery(queryData) {
  console.log('\n' + '='.repeat(60));
  console.log(`📋 Testing Query: "${queryData.query}"`);
  console.log(`🔧 Provider: ${queryData.provider}`);
  if (queryData.context) {
    console.log(`📝 Context: ${queryData.context}`);
  }
  console.log('='.repeat(60));

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(queryData)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('❌ Error:', data.error || 'Unknown error');
      console.error('Message:', data.message);
      return;
    }

    console.log('\n✅ Success! Results:');
    
    data.results.forEach((result, index) => {
      console.log(`\n${index + 1}. ${result.provider.toUpperCase()} Response:`);
      console.log('-'.repeat(40));
      
      if (result.error) {
        console.log(`❌ Error: ${result.error}`);
      } else {
        console.log(result.response);
        console.log(`\n📊 Response length: ${result.response.length} characters`);
      }
      
      console.log(`⏰ Timestamp: ${result.timestamp}`);
    });

  } catch (error) {
    console.error('❌ Request failed:', error.message);
  }
}

// Function to test the GET endpoint
async function testGetEndpoint() {
  console.log('\n' + '='.repeat(60));
  console.log('📋 Testing GET endpoint for API info');
  console.log('='.repeat(60));

  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    console.log('\nAPI Information:');
    console.log(JSON.stringify(data, null, 2));
  } catch (error) {
    console.error('❌ GET request failed:', error.message);
  }
}

// Main test function
async function runTests() {
  console.log('🚀 Starting User Query API Tests');
  console.log('📍 API URL:', API_URL);
  
  // First test the GET endpoint
  await testGetEndpoint();

  // Then test each query
  for (const queryData of testQueries) {
    await testQuery(queryData);
    
    // Add a small delay between requests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests completed!');
  console.log('='.repeat(60));
}

// Run the tests
runTests().catch(console.error); 