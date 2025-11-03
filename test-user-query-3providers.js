const http = require('http');

async function testUserQuery() {
  console.log('🧪 Testing Enhanced User Query API');
  console.log('==================================');
  console.log('Providers: ChatGPT Search, Google AI Overview, Perplexity AI');
  console.log('Modal-ready results...\n');
  
  const testData = {
    query: 'What are the latest trends in artificial intelligence for 2025?',
    context: 'Focus on practical applications and business impact',
    userId: 'test-user-123'
  };
  
  const postData = JSON.stringify(testData);
  const ports = [3000, 3001, 3002, 3003];
  
  for (const port of ports) {
    console.log(`🔍 Trying port ${port}...`);
    
    try {
      const result = await makeRequest(port, postData);
      
      console.log(`✅ Connected to server on port ${port}`);
      console.log('\n📊 Query Results:');
      console.log('=================');
      console.log(`Success: ${result.success}`);
      console.log(`Query: "${result.query}"`);
      console.log(`Total Results: ${result.totalResults}`);
      console.log(`Successful Results: ${result.successfulResults}`);
      console.log(`Total Cost: $${result.totalCost}`);
      console.log(`Total Time: ${result.totalTime}ms`);
      
      if (result.summary) {
        console.log('\n🎯 Provider Summary (Modal Display):');
        console.log('====================================');
        
        if (result.summary.chatgptSearch) {
          const cgs = result.summary.chatgptSearch;
          console.log(`\n🔍 ChatGPT Search:`);
          console.log(`  Content Length: ${cgs.content?.length || 0} characters`);
          console.log(`  Web Search Used: ${cgs.webSearchUsed ? 'Yes' : 'No'}`);
          console.log(`  Citations: ${cgs.citations}`);
          console.log(`  Response Time: ${cgs.responseTime}ms`);
        }
        
        if (result.summary.googleAiOverview) {
          const gao = result.summary.googleAiOverview;
          console.log(`\n📊 Google AI Overview:`);
          console.log(`  Total Items: ${gao.totalItems}`);
          console.log(`  People Also Ask: ${gao.peopleAlsoAskCount}`);
          console.log(`  Organic Results: ${gao.organicResultsCount}`);
          console.log(`  Location: ${gao.location}`);
          console.log(`  Response Time: ${gao.responseTime}ms`);
        }
        
        if (result.summary.perplexity) {
          const px = result.summary.perplexity;
          console.log(`\n🧠 Perplexity AI:`);
          console.log(`  Content Length: ${px.content?.length || 0} characters`);
          console.log(`  Citations: ${px.citations}`);
          console.log(`  Real-time Data: ${px.realTimeData ? 'Yes' : 'No'}`);
          console.log(`  Response Time: ${px.responseTime}ms`);
        }
      }
      
      if (result.results && result.results.length > 0) {
        console.log('\n📋 Detailed Provider Results:');
        console.log('=============================');
        
        result.results.forEach((provider, index) => {
          console.log(`\n${index + 1}. ${provider.providerId.toUpperCase()}:`);
          console.log(`   Status: ${provider.status}`);
          console.log(`   Response Time: ${provider.responseTime}ms`);
          console.log(`   Cost: $${provider.cost}`);
          
          if (provider.status === 'success' && provider.data) {
            if (provider.data.content) {
              console.log(`   Content Preview: ${provider.data.content.substring(0, 150)}...`);
            }
            if (provider.data.totalItems) {
              console.log(`   SERP Items: ${provider.data.totalItems}`);
            }
            if (provider.data.citations) {
              console.log(`   Citations: ${provider.data.citations.length}`);
            }
          } else if (provider.error) {
            console.log(`   Error: ${provider.error}`);
          }
        });
      }
      
      // Performance analysis
      console.log('\n⚡ Performance Analysis:');
      console.log('=======================');
      const avgResponseTime = result.totalTime / result.totalResults;
      console.log(`Average Response Time: ${avgResponseTime.toFixed(0)}ms`);
      console.log(`Cost per Provider: $${(result.totalCost / result.totalResults).toFixed(4)}`);
      console.log(`Success Rate: ${((result.successfulResults / result.totalResults) * 100).toFixed(1)}%`);
      
      // Modal readiness check
      console.log('\n📱 Modal Display Readiness:');
      console.log('===========================');
      console.log(`✅ Structured summary: ${result.summary ? 'Available' : 'Missing'}`);
      console.log(`✅ Provider breakdown: ${result.results ? 'Available' : 'Missing'}`);
      console.log(`✅ Performance metrics: Available`);
      console.log(`✅ Error handling: ${result.success ? 'Success' : 'Has errors'}`);
      
      return; // Exit after successful test
      
    } catch (error) {
      console.log(`❌ Port ${port}: ${error.message}`);
    }
  }
  
  console.log('\n❌ No server found on any port');
  console.log('💡 Make sure to:');
  console.log('1. Run: npm run dev');
  console.log('2. Ensure all 3 provider API keys are set:');
  console.log('   - OPENAI_API_KEY (for ChatGPT Search)');
  console.log('   - PERPLEXITY_API_KEY (for Perplexity AI)');
  console.log('   - DATAFORSEO_USERNAME & DATAFORSEO_PASSWORD (for Google AI Overview)');
}

function makeRequest(port, postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/api/user-query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 120000 // 2 minutes for all 3 providers
    };
    
    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const jsonData = JSON.parse(data);
          resolve(jsonData);
        } catch (error) {
          reject(new Error(`Invalid JSON: ${error.message}`));
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout - 3 providers may take up to 2 minutes'));
    });
    
    req.write(postData);
    req.end();
  });
}

// Run the test
testUserQuery().catch(console.error); 