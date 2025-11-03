const http = require('http');

async function testPerplexity() {
  console.log('🧪 Testing Perplexity AI Sonar Provider');
  console.log('====================================');
  console.log('Model: sonar');
  console.log('Real-time web search enabled...\n');
  
  const testData = {
    prompt: 'What are the latest developments in AI technology in 2025?',
    model: 'sonar',
    temperature: 0.7,
    max_tokens: 1000
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
        console.log('\n🔍 Perplexity Analysis:');
        console.log('======================');
        console.log(`Model: ${result.data.model}`);
        console.log(`Content Length: ${result.data.content?.length || 0} characters`);
        console.log(`Citations Found: ${result.data.citations?.length || 0}`);
        console.log(`Web Search Enabled: ${result.data.webSearchEnabled ? 'Yes' : 'No'}`);
        console.log(`Real-time Data: ${result.data.realTimeData ? 'Yes' : 'No'}`);
        console.log(`Finish Reason: ${result.data.finish_reason}`);
        
        if (result.data.usage) {
          console.log('\n💰 Token Usage:');
          console.log(`Prompt Tokens: ${result.data.usage.prompt_tokens}`);
          console.log(`Completion Tokens: ${result.data.usage.completion_tokens}`);
          console.log(`Total Tokens: ${result.data.usage.total_tokens}`);
        }
        
        if (result.data.citations && result.data.citations.length > 0) {
          console.log('\n📚 Citations:');
          result.data.citations.slice(0, 5).forEach((citation, i) => {
            console.log(`${i + 1}. ${citation}`);
          });
        }
        
        if (result.data.content) {
          console.log('\n📝 Response Preview:');
          console.log('==================');
          console.log(result.data.content.substring(0, 300) + '...');
        }
      }
      
      return; // Exit after successful test
      
    } catch (error) {
      console.log(`❌ Port ${port}: ${error.message}`);
    }
  }
  
  console.log('\n❌ No server found on any port');
  console.log('💡 Make sure to:');
  console.log('1. Run: npm run dev');
  console.log('2. Set PERPLEXITY_API_KEY in your .env.local file');
}

function makeRequest(port, postData) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: port,
      path: '/api/test-perplexity',
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
testPerplexity().catch(console.error); 