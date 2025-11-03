/**
 * Test script for ChatGPT Search Provider
 * 
 * This script demonstrates how to use the new ChatGPT Search provider
 * that includes web search capabilities through OpenAI's responses API.
 */

const { ProviderManager } = require('./src/lib/api-providers/provider-manager');

async function testChatGPTSearch() {
  console.log('🔍 Testing ChatGPT Search Provider...\n');

  // Initialize the provider manager
  const providerManager = new ProviderManager();

  // Test queries that benefit from web search
  const testQueries = [
    {
      id: 'test-1',
      prompt: 'What are the latest trends in AI and machine learning in 2024?',
      providers: ['chatgptsearch'], // Use only ChatGPT Search
      priority: 'high',
      userId: 'test-user-1',
      metadata: { testCase: 'current-trends' }
    },
    {
      id: 'test-2', 
      prompt: 'What was the most significant tech news from today?',
      providers: ['chatgptsearch'],
      priority: 'high',
      userId: 'test-user-2',
      metadata: { testCase: 'current-news' }
    },
    {
      id: 'test-3',
      prompt: 'Compare the latest iPhone vs Samsung Galaxy models released in 2024',
      providers: ['chatgptsearch'],
      priority: 'medium',
      userId: 'test-user-3',
      metadata: { testCase: 'product-comparison' }
    }
  ];

  // Execute test queries
  for (const query of testQueries) {
    try {
      console.log(`\n📝 Testing Query: "${query.prompt}"`);
      console.log('🔄 Processing with ChatGPT Search...');
      
      const startTime = Date.now();
      const result = await providerManager.executeRequest({
        ...query,
        createdAt: new Date()
      });
      
      const processingTime = Date.now() - startTime;
      
      console.log('✅ Results:', {
        requestId: result.requestId,
        totalResults: result.results.length,
        successfulResults: result.results.filter(r => r.status === 'success').length,
        totalCost: result.totalCost,
        processingTime: processingTime + 'ms'
      });

      // Display ChatGPT Search specific results
      const chatgptSearchResult = result.results.find(r => r.providerId === 'chatgptsearch');
      if (chatgptSearchResult && chatgptSearchResult.status === 'success') {
        console.log('🌐 ChatGPT Search Response:', {
          model: chatgptSearchResult.data.model,
          searchEnabled: chatgptSearchResult.data.searchEnabled,
          webSearchUsed: chatgptSearchResult.data.webSearchUsed,
          responseLength: chatgptSearchResult.data.content.length,
          responsePreview: chatgptSearchResult.data.content.substring(0, 200) + '...',
          cost: chatgptSearchResult.cost,
          responseTime: chatgptSearchResult.responseTime + 'ms'
        });
      } else {
        console.log('❌ ChatGPT Search failed:', chatgptSearchResult?.error);
      }

      // Add delay between requests to respect rate limits
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error('❌ Test failed:', error.message);
    }
  }

  // Test provider status
  console.log('\n🔍 Checking Provider Status...');
  const providerStatus = await providerManager.getProviderStatus();
  console.log('📊 Provider Status:', providerStatus);

  console.log('\n✅ ChatGPT Search Provider testing completed!');
}

// Run the test
if (require.main === module) {
  testChatGPTSearch().catch(console.error);
}

module.exports = { testChatGPTSearch }; 