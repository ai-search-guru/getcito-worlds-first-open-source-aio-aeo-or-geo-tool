# Domain Analysis System with Gemini AI

## 🎯 **Overview**

This system automatically fetches HTML content from any domain and uses Google's Gemini AI to perform intelligent brand analysis, extracting structured business information, SEO metrics, and actionable insights.

## 🏗️ **Architecture**

### **Components:**
1. **HTMLFetcher** - Robust web scraping with content cleaning
2. **GeminiAnalyzer** - AI-powered content analysis  
3. **DomainAnalyzer** - Orchestrates the entire process
4. **API Endpoints** - Easy integration with your app
5. **React Hooks** - Frontend integration utilities

### **Flow:**
```
Domain Input → HTML Fetch → Content Clean → Gemini Analysis → Structured Results
```

## 🚀 **Quick Start**

### **1. Environment Setup**
```bash
# Add to your .env file
GOOGLE_AI_API_KEY=your_gemini_api_key_here
```

### **2. Install Dependencies**
```bash
npm install jsdom @types/jsdom
```

### **3. Basic Usage**

#### **API Endpoint**
```javascript
// POST /api/analyze-domain
const response = await fetch('/api/analyze-domain', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ 
    domain: 'apple.com',
    mode: 'full' // or 'quick'
  })
});

const data = await response.json();
console.log(data.analysis);
```

#### **React Hook**
```tsx
import { useDomainAnalysis } from '@/hooks/useDomainAnalysis';

function MyComponent() {
  const { analyzeState, analyzeDomain } = useDomainAnalysis();
  
  const handleAnalyze = () => {
    analyzeDomain('apple.com', 'full');
  };
  
  return (
    <div>
      <button onClick={handleAnalyze}>Analyze Domain</button>
      {analyzeState.loading && <p>Analyzing...</p>}
      {analyzeState.result && (
        <div>
          <h2>{analyzeState.result.brandInfo.name}</h2>
          <p>{analyzeState.result.brandInfo.description}</p>
        </div>
      )}
    </div>
  );
}
```

#### **Direct Usage**
```typescript
import { DomainAnalyzer } from '@/lib/domain-analyzer/domain-analyzer';

const analyzer = new DomainAnalyzer('your-gemini-api-key');
const result = await analyzer.analyzeDomain('apple.com');

console.log(result.analysis.brandInfo);
```

## 📊 **Analysis Results Structure**

The system extracts comprehensive information:

```typescript
interface AnalysisResult {
  brandInfo: {
    name: string;           // "Apple Inc."
    description: string;    // "Technology company..."
    industry: string;       // "Consumer Electronics"
    foundedYear?: number;   // 1976
    headquarters?: string;  // "Cupertino, CA"
    ceo?: string;          // "Tim Cook"
  };
  
  products: Array<{
    name: string;          // "iPhone"
    description: string;   // "Smartphone device..."
    category: string;      // "Mobile Devices"
    price?: string;        // "Starting at $999"
  }>;
  
  services: Array<{
    name: string;          // "iCloud"
    description: string;   // "Cloud storage service..."
    category: string;      // "Cloud Services"
  }>;
  
  businessModel: {
    type: string;          // "B2C"
    revenue: string;       // "Product Sales"
    targetAudience: string; // "Consumers"
  };
  
  keyFeatures: string[];          // ["Advanced Camera", "Face ID"]
  competitiveAdvantages: string[]; // ["Ecosystem Integration"]
  
  socialMedia: {
    platforms: string[];    // ["Twitter", "YouTube"]
    presence: 'strong' | 'moderate' | 'weak' | 'none';
  };
  
  technology: {
    stack?: string[];       // ["React", "Node.js"]
    frameworks?: string[];  // ["Next.js"]
    platforms?: string[];   // ["iOS", "Android"]
  };
  
  contact: {
    email?: string;         // "support@apple.com"
    phone?: string;         // "1-800-APL-CARE"
    address?: string;       // "1 Apple Park Way..."
    supportChannels?: string[]; // ["Chat", "Phone"]
  };
  
  seoMetrics: {
    titleOptimization: 'good' | 'fair' | 'poor';
    descriptionQuality: 'good' | 'fair' | 'poor';
    structuredData: boolean;
    contentQuality: 'high' | 'medium' | 'low';
  };
  
  sentiment: {
    overall: 'positive' | 'neutral' | 'negative';
    confidence: number;     // 0.0 - 1.0
    reasons: string[];      // ["Strong brand presence"]
  };
  
  recommendations: string[]; // ["Improve meta description"]
  confidence: number;        // 0.0 - 1.0
  processingTime: number;    // milliseconds
}
```

## 🔧 **API Endpoints**

### **POST /api/analyze-domain**
Full domain analysis with detailed extraction.

**Request:**
```json
{
  "domain": "apple.com",
  "mode": "full" // or "quick"
}
```

**Response:**
```json
{
  "success": true,
  "domain": "apple.com",
  "analysis": { /* AnalysisResult */ },
  "metadata": {
    "processingTime": 15000,
    "contentLength": 50000,
    "confidence": 0.85,
    "mode": "full"
  }
}
```

### **GET /api/analyze-domain?domain=apple.com**
Quick analysis with essential information only.

**Response:**
```json
{
  "success": true,
  "domain": "apple.com",
  "brandInfo": { /* Brand information */ },
  "businessModel": { /* Business model */ },
  "seoMetrics": { /* SEO metrics */ },
  "confidence": 0.85,
  "processingTime": 8000
}
```

## ⚡ **Features**

### **🔍 Intelligent Content Extraction**
- **Smart Parsing**: Removes ads, navigation, and irrelevant content
- **Multiple Sources**: Tries title, meta tags, Open Graph, Twitter Cards
- **Content Cleaning**: Normalizes whitespace and formatting
- **Structured Data**: Extracts JSON-LD and schema markup

### **🧠 AI-Powered Analysis**
- **Brand Intelligence**: Identifies company info, products, services
- **Business Analysis**: Determines business model and target audience
- **SEO Assessment**: Evaluates technical and content SEO factors
- **Sentiment Analysis**: Analyzes overall brand sentiment
- **Recommendations**: Provides actionable improvement suggestions

### **⚡ Performance Optimization**
- **Two Modes**: 
  - `full` - Complete analysis (~15-30 seconds)
  - `quick` - Essential info only (~5-10 seconds)
- **Content Limiting**: Prevents token overflow
- **Parallel Processing**: Can analyze multiple domains
- **Error Handling**: Graceful fallbacks and recovery

### **🛡️ Robust Error Handling**
- **Network Issues**: Timeouts, connection failures
- **Content Issues**: Invalid HTML, blocked access
- **AI Issues**: API failures, parsing errors
- **Fallback Results**: Always returns structured data

## 🔧 **Integration Examples**

### **Add to Brand Onboarding Flow**

```tsx
// In your add-brand step-1 page
import { useDomainAnalysis } from '@/hooks/useDomainAnalysis';

export default function AddBrandStep1() {
  const { analyzeState, analyzeDomain } = useDomainAnalysis();
  
  const handleAnalyzeDomain = async () => {
    if (!domain.trim()) return;
    
    // Start analysis
    await analyzeDomain(domain, 'quick');
    
    // Use results to pre-populate form
    if (analyzeState.result) {
      setBrandName(analyzeState.result.brandInfo.name);
      setDescription(analyzeState.result.brandInfo.description);
      setIndustry(analyzeState.result.brandInfo.industry);
    }
  };
  
  return (
    <div>
      <input 
        value={domain} 
        onChange={(e) => setDomain(e.target.value)}
        placeholder="Enter domain"
      />
      <button onClick={handleAnalyzeDomain}>
        {analyzeState.loading ? 'Analyzing...' : 'Analyze Domain'}
      </button>
      
      {/* Show analysis results */}
      {analyzeState.result && (
        <div className="analysis-preview">
          <h3>{analyzeState.result.brandInfo.name}</h3>
          <p>{analyzeState.result.brandInfo.description}</p>
          <div>Industry: {analyzeState.result.brandInfo.industry}</div>
          <div>Confidence: {Math.round(analyzeState.result.confidence * 100)}%</div>
        </div>
      )}
    </div>
  );
}
```

### **Batch Analysis**

```typescript
import { DomainAnalyzer } from '@/lib/domain-analyzer/domain-analyzer';

const analyzer = new DomainAnalyzer(process.env.GOOGLE_AI_API_KEY!);

// Analyze multiple competitors
const domains = ['apple.com', 'samsung.com', 'google.com'];
const results = await analyzer.analyzeMultipleDomains(domains);

results.forEach(result => {
  if (result.success) {
    console.log(`${result.domain}: ${result.analysis.brandInfo.name}`);
  }
});
```

### **Save to Database**

```typescript
// After analysis, save to Firestore
const result = await analyzer.analyzeDomain('apple.com');

if (result.success) {
  await addData('domain_analysis', result.domain, {
    ...result.analysis,
    analyzedAt: new Date(),
    confidence: result.analysis.confidence,
  });
}
```

## 🎯 **Use Cases**

### **1. Brand Onboarding**
- Auto-populate brand information during signup
- Extract company details, products, services
- Identify business model and target audience

### **2. Competitor Analysis**
- Analyze competitor websites automatically
- Compare business models and offerings
- Track sentiment and positioning

### **3. SEO Auditing**
- Evaluate technical SEO factors
- Assess content quality and optimization
- Generate improvement recommendations

### **4. Market Research**
- Extract structured company data at scale
- Identify industry trends and patterns
- Build comprehensive company profiles

### **5. Lead Qualification**
- Analyze prospect websites quickly
- Understand business model and needs
- Prepare personalized outreach

## 🚀 **Performance Tips**

### **1. Choose the Right Mode**
- Use `quick` for real-time user interactions
- Use `full` for comprehensive background analysis

### **2. Implement Caching**
```typescript
// Cache results to avoid re-analysis
const cacheKey = `domain:${domain}`;
const cached = await redis.get(cacheKey);
if (cached) return JSON.parse(cached);

const result = await analyzer.analyzeDomain(domain);
await redis.setex(cacheKey, 3600, JSON.stringify(result)); // 1 hour cache
```

### **3. Background Processing**
```typescript
// Queue analysis for background processing
import Queue from 'bull';

const analysisQueue = new Queue('domain analysis');

analysisQueue.add('analyze', { domain: 'apple.com' });
analysisQueue.process('analyze', async (job) => {
  return await analyzer.analyzeDomain(job.data.domain);
});
```

## 🔒 **Security & Rate Limiting**

### **1. API Key Security**
- Store Gemini API key in environment variables
- Never expose API keys in client-side code
- Rotate keys regularly

### **2. Rate Limiting**
```typescript
// Implement rate limiting per user
const rateLimiter = new Map();

const checkRateLimit = (userId: string) => {
  const now = Date.now();
  const userRequests = rateLimiter.get(userId) || [];
  
  // Allow 5 requests per hour
  const recentRequests = userRequests.filter(time => now - time < 3600000);
  if (recentRequests.length >= 5) {
    throw new Error('Rate limit exceeded');
  }
  
  rateLimiter.set(userId, [...recentRequests, now]);
};
```

### **3. Content Validation**
- Validate domains before analysis
- Filter out malicious or inappropriate content
- Implement content size limits

## 📈 **Monitoring & Analytics**

### **Key Metrics to Track**
- Analysis success/failure rates
- Processing times by domain type
- Gemini API usage and costs
- User satisfaction with results

### **Error Monitoring**
```typescript
// Log errors for monitoring
const logAnalysisError = (domain: string, error: Error) => {
  console.error('Domain analysis failed', {
    domain,
    error: error.message,
    timestamp: new Date().toISOString(),
    stack: error.stack,
  });
};
```

---

This system provides **intelligent, automated domain analysis** that can extract structured business information from any website using the power of Gemini AI! 🚀 