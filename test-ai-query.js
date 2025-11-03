const fetch = require('node-fetch');

async function testAIQuery() {
  try {
    console.log('🧪 Testing AI Query API...');
    
    const response = await fetch('http://localhost:3002/api/ai-query', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        prompt: 'Hello, this is a test prompt. Please respond with a simple greeting.',
        providers: ['azure-openai'], // Test specifically with OpenAI
        priority: 'medium',
        userId: 'test-user-123'
      })
    });

    const data = await response.json();
    
    console.log('📤 Response Status:', response.status);
    console.log('📋 Response Data:', JSON.stringify(data, null, 2));
    
  } catch (error) {
    console.error('❌ Test Error:', error);
  }
}

testAIQuery(); 