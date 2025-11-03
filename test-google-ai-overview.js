const http = require('http');

async function testGoogleAIOverview() {
  console.log('🧪 Testing Google AI Overview Provider');
  console.log('=====================================');
  console.log('Location Code: 2840');
  console.log('Testing People Also Ask fix...\n');
  
  const testData = {
    keyword: 'best AI tools for content creation',
    location_code: 2840,
    language_code: 'en'
  };
  
  const postData = JSON.stringify(testData);
  const ports = [3000, 3001, 3002, 3003];
  
  for (const port of ports) {
    console.log(`🔍 Trying port ${port}...`);
    
    try {
      const result = await makeRequest(port, postData);
      
      console.log(`✅ Connected to server on port ${port}`);
      console.log('\n📊 Results:');
      console.log('===========');
      console.log(`Status: ${result.status}`);
      console.log(`Provider: ${result.providerId}`);
      console.log(`Response Time: ${result.responseTime}ms`);
      console.log(`Cost: $${result.cost}`);
      
      if (result.data) {
        console.log('\n🔍 SERP Analysis:');
        console.log('=================');
        console.log(`Total Items: ${result.data.totalItems || 0}`);
        console.log(`People Also Ask: ${result.data.peopleAlsoAskCount || 0}`);
        console.log(`Organic Results: ${result.data.organicResultsCount || 0}`);
        console.log(`Video Results: ${result.data.videoResultsCount || 0}`);
        console.log(`Related Searches: ${result.data.relatedSearchesCount || 0}`);
        console.log(`Location: ${result.data.location || 'Not specified'}`);
        
        // Check People Also Ask fix
        if (result.data.peopleAlsoAskCount > 0) {
          console.log('\n🎉 SUCCESS: People Also Ask Fix Working!');
          console.log(`✅ Found ${result.data.peopleAlsoAskCount} People Also Ask items`);
        } else {
          console.log('\n⚠️  People Also Ask count is still 0');
        }
        
        // Check location code
        console.log('\n📍 Location Verification:');
        console.log(`✅ Used location code 2840`);
        console.log(`📍 Response location: ${result.data.location || 'Not specified'}`);
      }
      
      return; // Exit after successful test
      
    } catch (error) {
      console.log(`❌ Port ${port}: ${error.message}`);
    }
  }
  
  console.log('\n❌ No server found on any port');
  console.log('💡 Run: npm run dev');
}

function makeRequest(port, postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/api/test-google-ai-overview',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000
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
      reject(new Error('Request timeout'));
    });
    
    req.write(postData);
    req.end();
  });
}

// Run the test
testGoogleAIOverview().catch(console.error); 