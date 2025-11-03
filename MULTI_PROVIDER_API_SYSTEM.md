# Multi-Provider API System

## 🏗️ **Architecture Overview**

This system enables you to make similar prompts across multiple API providers (Azure OpenAI, Google Gemini, Tracxn, SEO APIs) and aggregate results intelligently.

### **Key Components:**

1. **BaseAPIProvider** - Abstract class for all providers
2. **ProviderManager** - Orchestrates multiple providers
3. **Job Queue System** - Handles concurrent requests
4. **Result Aggregation** - Combines and analyzes responses
5. **Cost Tracking** - Monitors API usage costs

## 🚀 **Quick Start**

### **1. Environment Setup**

```bash
# Azure OpenAI
AZURE_OPENAI_API_KEY=your_azure_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT=your-deployment-name

# Google AI
GOOGLE_AI_API_KEY=your_google_ai_key

# SEO APIs
SEMRUSH_API_KEY=your_semrush_key
AHREFS_API_KEY=your_ahrefs_key

# Tracxn
TRACXN_API_KEY=your_tracxn_key
```

### **2. Basic Usage**

```typescript
import { ProviderManager } from '@/lib/api-providers/provider-manager';

const manager = new ProviderManager();

// Execute across multiple providers
const result = await manager.executeRequest({
  id: 'unique-request-id',
  prompt: 'Analyze the brand sentiment for Apple Inc.',
  providers: ['azure-openai', 'google-gemini'], // or [] for all
  priority: 'high',
  userId: 'user123',
  createdAt: new Date(),
});

console.log(result.aggregatedData);
```

### **3. API Endpoint Usage**

```javascript
// POST /api/ai-query
const response = await fetch('/api/ai-query', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    prompt: 'What are the top competitors for Tesla?',
    providers: ['azure-openai', 'google-gemini'],
    priority: 'medium',
    userId: 'user123'
  })
});

const data = await response.json();
```

## 📋 **Provider Types**

### **AI Providers**

#### **Azure OpenAI**
```typescript
const azureProvider = new AzureOpenAIProvider({
  apiKey: 'your-key',
  azureEndpoint: 'https://your-resource.openai.azure.com',
  deploymentName: 'gpt-4',
  timeout: 30000,
  retryAttempts: 3
});
```

#### **Google Gemini**
```typescript
const geminiProvider = new GeminiProvider({
  apiKey: 'your-google-ai-key',
  timeout: 30000,
  retryAttempts: 3
});
```

### **SEO Providers**

#### **SEMrush/Ahrefs/Moz**
```typescript
const seoProvider = new SEOProvider({
  service: 'semrush', // or 'ahrefs', 'moz'
  apiKey: 'your-seo-key',
  timeout: 30000,
  retryAttempts: 3
});
```

### **Data Providers**

#### **Tracxn (Coming Soon)**
```typescript
const tracxnProvider = new TracxnProvider({
  apiKey: 'your-tracxn-key',
  timeout: 30000,
  retryAttempts: 3
});
```

## 🔄 **Advanced Features**

### **1. Parallel Execution**
```typescript
// All providers execute simultaneously
const result = await manager.executeRequest({
  prompt: 'Brand analysis for Nike',
  providers: [], // Empty = all available providers
  // ...
});
```

### **2. Priority Queuing**
```typescript
// High priority requests get processed first
const urgentRequest = {
  prompt: 'Critical brand analysis needed',
  priority: 'high' as const,
  // ...
};
```

### **3. Result Aggregation**
```typescript
// Automatic consensus building
const result = await manager.executeRequest(request);

console.log({
  consensus: result.aggregatedData.consensus,
  allResponses: result.aggregatedData.responses,
  confidence: result.aggregatedData.responses[0].confidence,
  totalCost: result.totalCost
});
```

### **4. Cost Tracking**
```typescript
// Monitor API costs in real-time
const result = await manager.executeRequest(request);
console.log(`Total cost: $${result.totalCost}`);

// Individual provider costs
result.results.forEach(r => {
  console.log(`${r.providerId}: $${r.cost}`);
});
```

### **5. Health Monitoring**
```typescript
// Check provider availability
const status = await manager.getProviderStatus();
console.log(status);
// { 'azure-openai': true, 'google-gemini': false }
```

## 🛠️ **Extending the System**

### **Add New Provider**

1. **Create Provider Class**
```typescript
export class CustomProvider extends BaseAPIProvider {
  constructor(config: ProviderConfig) {
    super('custom-api', 'data', config);
  }

  async execute(request: any): Promise<APIResponse> {
    // Implementation
  }

  validateRequest(request: any): boolean {
    // Validation logic
  }

  transformResponse(rawResponse: any): any {
    // Transform to standard format
  }
}
```

2. **Register Provider**
```typescript
const manager = new ProviderManager();
manager.addProvider('custom-api', new CustomProvider(config));
```

### **Custom Aggregation Logic**

```typescript
class CustomProviderManager extends ProviderManager {
  protected aggregateResults(results: APIResponse[]): any {
    // Your custom aggregation logic
    return {
      bestResponse: this.selectBestResponse(results),
      confidence: this.calculateOverallConfidence(results),
      // ...
    };
  }
}
```

## 📊 **Performance Optimization**

### **1. Caching**
```typescript
// Add Redis caching layer
const cachedResult = await redis.get(`request:${requestHash}`);
if (cachedResult) return JSON.parse(cachedResult);
```

### **2. Rate Limiting**
```typescript
// Implement Redis-based rate limiting
protected async checkRateLimit(): Promise<boolean> {
  const key = `rate:${this.name}:${userId}`;
  const current = await redis.incr(key);
  if (current === 1) await redis.expire(key, 60);
  return current <= this.rateLimit.requestsPerMinute;
}
```

### **3. Request Queuing**
```typescript
// Use Bull queue for background processing
import Queue from 'bull';

const apiQueue = new Queue('api requests');
apiQueue.process(async (job) => {
  return await manager.executeRequest(job.data);
});
```

## 🔒 **Security & Best Practices**

### **1. API Key Management**
- Store in environment variables
- Rotate keys regularly
- Use different keys per environment

### **2. Rate Limiting**
- Implement per-user limits
- Monitor provider quotas
- Graceful degradation

### **3. Error Handling**
- Comprehensive logging
- Fallback providers
- Circuit breaker pattern

### **4. Cost Control**
- Set spending limits
- Monitor usage patterns
- Alert on high costs

## 🚀 **Deployment Considerations**

### **Development**
```bash
npm run dev
# Providers auto-configure from env vars
```

### **Production**
```bash
# Add monitoring
npm install @sentry/nextjs
npm install redis bull

# Environment variables
export NODE_ENV=production
export REDIS_URL=redis://localhost:6379
```

### **Scaling**
- Use Redis for caching and queues
- Implement horizontal scaling
- Add load balancing
- Monitor with APM tools

## 📈 **Monitoring & Analytics**

### **Key Metrics**
- Response times per provider
- Success/failure rates
- Cost per request
- Provider availability
- Queue depth

### **Dashboards**
- Real-time provider status
- Cost tracking charts
- Performance comparisons
- Error rate monitoring

## 🔮 **Future Enhancements**

1. **Machine Learning Aggregation**
   - Train models on response quality
   - Dynamic provider selection
   - Confidence scoring

2. **Advanced Queuing**
   - Priority-based scheduling
   - Load balancing
   - Auto-scaling

3. **Real-time Analytics**
   - Live dashboards
   - Alerting system
   - Performance optimization

4. **Provider Marketplace**
   - Plugin architecture
   - Community providers
   - A/B testing framework

---

This system provides a robust, scalable foundation for multi-provider API orchestration with built-in monitoring, cost tracking, and intelligent result aggregation! 🎉 