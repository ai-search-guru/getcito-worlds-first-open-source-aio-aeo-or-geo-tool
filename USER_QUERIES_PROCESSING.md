# User Queries Processing System

## Overview

This system processes user queries from their brands through AI providers (OpenAI and Gemini) and stores the responses in a Firestore collection called `v8userqueries`. This enables tracking AI responses for each query and provides insights into how different AI providers respond to brand-related queries.

## Architecture

### Components

1. **Firestore Collection** (`v8userqueries`)
   - Stores processed queries with AI responses
   - Tracks processing status and timestamps
   - Links queries to users and brands

2. **API Endpoints**
   - `/api/user-query` - Queries AI providers
   - `/api/process-user-queries` - Processes brand queries in bulk

3. **Firebase Functions**
   - `userQueries.ts` - CRUD operations for the Firestore collection
   - `getUserBrands.ts` - Fetches user brands with queries

4. **React Hook**
   - `useProcessedQueries` - Manages processed queries in the UI

## Data Structure

### UserQueryDocument
```typescript
{
  id: string;
  userId: string;
  brandId: string;
  brandName: string;
  originalQuery: string;
  keyword: string;
  category: string;
  aiResponses: AIResponse[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  processedAt?: Timestamp;
}
```

### AIResponse
```typescript
{
  provider: string;
  response: string;
  error?: string;
  timestamp: string;
  responseTime?: number;
  tokenCount?: any;
}
```

## API Usage

### Process User Queries

**Endpoint:** `POST /api/process-user-queries`

**Request Body:**
```json
{
  "userId": "user-id-here",
  "brandId": "specific-brand-id", // Optional
  "processAll": true // Optional
}
```

**Response:**
```json
{
  "success": true,
  "processed": [
    {
      "queryId": "generated-id",
      "brand": "Brand Name",
      "query": "Query text...",
      "status": "completed",
      "responseCount": 2
    }
  ],
  "errors": [],
  "summary": {
    "totalProcessed": 10,
    "totalErrors": 0,
    "brandsProcessed": 2
  }
}
```

## Using the React Hook

```typescript
import { useProcessedQueries } from '@/hooks/useProcessedQueries';

function MyComponent() {
  const { 
    queries, 
    loading, 
    error, 
    refetch, 
    processQueries, 
    stats 
  } = useProcessedQueries({
    brandId: 'optional-brand-id',
    autoRefresh: true,
    refreshInterval: 30000 // 30 seconds
  });

  // Process new queries
  const handleProcess = async () => {
    await processQueries();
  };

  // Display stats
  console.log(`Total: ${stats.total}`);
  console.log(`Completed: ${stats.completed}`);
  console.log(`Processing: ${stats.processing}`);
  console.log(`Errors: ${stats.errors}`);

  return (
    <div>
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      
      <button onClick={handleProcess}>
        Process Queries
      </button>
      
      {queries.map(query => (
        <div key={query.id}>
          <h3>{query.originalQuery}</h3>
          <p>Status: {query.status}</p>
          {query.aiResponses.map((response, idx) => (
            <div key={idx}>
              <h4>{response.provider}</h4>
              <p>{response.response}</p>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

## Testing

### 1. Test Processing Script

```bash
node test-process-queries.js
```

**Before running:**
1. Get a user ID from Firebase Auth
2. Update `TEST_USER_ID` in the script
3. Ensure AI API keys are configured

### 2. Find User ID

In the browser console while logged in:
```javascript
JSON.parse(localStorage.getItem("user")).uid
```

### 3. Process Specific Brand

```javascript
testProcessSpecificBrand('your-brand-id').catch(console.error);
```

## Processing Flow

1. **Fetch User Brands**
   - Get all brands for the user
   - Filter by brandId if specified

2. **Process Each Query**
   - Create document in Firestore
   - Send query to AI providers
   - Store responses
   - Update status

3. **Handle Errors**
   - Log errors for each query
   - Continue processing other queries
   - Return summary with errors

## Features

- **Bulk Processing**: Process all queries for all brands
- **Selective Processing**: Process queries for specific brands
- **Error Handling**: Graceful error handling with detailed logging
- **Rate Limiting**: 1-second delay between queries
- **Status Tracking**: Track processing status for each query
- **Auto-refresh**: Optional auto-refresh in the React hook

## Best Practices

1. **Rate Limiting**: The system includes a 1-second delay between queries to avoid API rate limits

2. **Error Recovery**: Failed queries are marked with error status and can be reprocessed

3. **Context Enhancement**: Each query includes brand context for better AI responses

4. **Monitoring**: Use console logs to monitor processing progress

5. **Batch Processing**: Process multiple queries efficiently in a single request

## Future Enhancements

- Queue system for large-scale processing
- Retry mechanism for failed queries
- Analytics dashboard for query insights
- Export functionality for processed queries
- Comparison tools for AI responses
- Scheduled processing jobs 