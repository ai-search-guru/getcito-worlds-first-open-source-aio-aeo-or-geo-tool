# User Query API Documentation

## Overview

The User Query API (`/api/user-query`) allows you to send queries to multiple AI providers (OpenAI and Google Gemini) and receive responses. The API supports querying individual providers or both simultaneously for comparison.

## Features

- **Multi-Provider Support**: Query OpenAI, Google Gemini, or both
- **Context Support**: Add custom context to guide AI responses
- **Error Handling**: Graceful error handling with detailed error messages
- **Console Logging**: All queries and responses are logged to the console
- **TypeScript Support**: Fully typed for better developer experience

## API Endpoints

### GET /api/user-query
Returns API information and usage examples.

### POST /api/user-query
Submit a query to AI providers.

**Request Body:**
```json
{
  "query": "Your question here",
  "provider": "openai" | "gemini" | "both",
  "context": "Optional context for the query"
}
```

**Response:**
```json
{
  "success": true,
  "query": "Your question here",
  "results": [
    {
      "provider": "openai",
      "response": "AI response text",
      "timestamp": "2024-01-10T10:00:00.000Z"
    },
    {
      "provider": "gemini",
      "response": "AI response text",
      "timestamp": "2024-01-10T10:00:01.000Z"
    }
  ],
  "timestamp": "2024-01-10T10:00:01.000Z"
}
```

## Environment Variables

### OpenAI Configuration

The API supports both Azure OpenAI and direct OpenAI:

**Azure OpenAI (Recommended):**
```env
AZURE_OPENAI_API_KEY=your_azure_openai_api_key
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_DEPLOYMENT_NAME=your_deployment_name
```

**Direct OpenAI:**
```env
OPENAI_API_KEY=your_openai_api_key
```

### Google Gemini Configuration

```env
GOOGLE_AI_API_KEY=your_google_ai_api_key
# OR
GEMINI_API_KEY=your_gemini_api_key
```

## Usage Examples

### Using the Test Script

Run the provided test script:
```bash
node test-user-query.js
```

### Using in React Components

Use the provided hook:
```typescript
import { useUserQuery } from '@/hooks/useUserQuery';

function MyComponent() {
  const { query, results, loading, error } = useUserQuery();

  const handleQuery = async () => {
    await query('What is React?', {
      provider: 'both',
      context: 'Explain in simple terms'
    });
  };

  return (
    <div>
      <button onClick={handleQuery} disabled={loading}>
        Ask AI
      </button>
      
      {loading && <p>Loading...</p>}
      {error && <p>Error: {error}</p>}
      
      {results.map((result, index) => (
        <div key={index}>
          <h3>{result.provider}</h3>
          <p>{result.response}</p>
        </div>
      ))}
    </div>
  );
}
```

### Direct API Call

```javascript
const response = await fetch('/api/user-query', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    query: 'What are the benefits of TypeScript?',
    provider: 'both',
    context: 'Focus on web development benefits'
  })
});

const data = await response.json();
console.log(data.results);
```

## Console Output

All queries and responses are logged to the console with emojis for easy identification:

- 📝 Received query - Initial query received
- 🤖 OpenAI Response - Response from OpenAI
- ✨ Gemini Response - Response from Gemini
- 📊 Response Comparison - Side-by-side comparison when using both providers
- ❌ Error logs - Any errors that occur

## Error Handling

The API handles various error scenarios:

1. **Missing API Keys**: Returns specific error message indicating which key is missing
2. **API Errors**: Captures and returns provider-specific error messages
3. **Network Errors**: Handles connection failures gracefully
4. **Invalid Requests**: Validates request body and returns 400 for invalid requests

## Model Information

- **OpenAI**: Uses GPT-3.5-turbo by default (or your Azure deployment)
- **Gemini**: Uses gemini-1.5-flash model
- **Temperature**: Set to 0.7 for balanced creativity/accuracy
- **Max Tokens**: Limited to 500 tokens per response

## Best Practices

1. **Use Context**: Provide clear context to get more accurate responses
2. **Compare Providers**: Use `provider: "both"` to compare responses
3. **Error Handling**: Always handle errors in your UI
4. **Rate Limiting**: Be mindful of API rate limits
5. **Caching**: Consider caching responses for repeated queries

## Troubleshooting

### "API key not configured" Error
- Ensure environment variables are set correctly
- Restart the development server after adding environment variables

### "Model not found" Error
- The API uses the latest available models
- Check if your API key has access to the required models

### "Deployment does not exist" Error (Azure)
- Verify your Azure OpenAI deployment name
- Ensure the deployment is active and accessible

## Future Enhancements

- Add support for streaming responses
- Implement response caching
- Add more AI providers (Anthropic, Cohere, etc.)
- Support for different model configurations
- Rate limiting and quota management 