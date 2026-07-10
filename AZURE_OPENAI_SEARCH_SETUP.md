# Azure OpenAI Search Provider Setup

This document explains how to set up the Azure OpenAI Search provider that replaces the ChatGPT Search provider for query monitoring.

## Overview

The Azure OpenAI Search provider uses Azure OpenAI's chat completions API with optional Azure Search integration for web-grounded responses. This provides:

- Direct integration with your Azure infrastructure
- Web search capabilities via Azure Search (optional)
- Citation/annotation support similar to ChatGPT Search
- Graceful fallback to standard completions if Azure Search is not configured

## Required Environment Variables

### Basic Configuration (Required)

Add these variables to your `.env` or `.env.local` file:

```bash
# Azure OpenAI Search Configuration
# Can reuse existing Azure OpenAI credentials or use separate ones
AZURE_OPENAI_SEARCH_API_KEY=your_azure_openai_api_key_here
AZURE_OPENAI_SEARCH_ENDPOINT=https://your-resource-name.openai.azure.com
AZURE_OPENAI_SEARCH_DEPLOYMENT=gpt-4
AZURE_OPENAI_API_VERSION=2024-10-21
```

**Note:** If you don't set separate `AZURE_OPENAI_SEARCH_*` variables, the system will fall back to using the standard `AZURE_OPENAI_*` variables.

### Azure Search Configuration (Optional but Recommended)

For web search capabilities with citations, configure Azure Search:

```bash
# Azure Search Configuration (Optional - enables web search)
AZURE_SEARCH_ENDPOINT=https://your-search.search.windows.net/
AZURE_SEARCH_INDEX=your-index-name
AZURE_SEARCH_API_KEY=your_azure_search_api_key
```

## How It Works

### With Azure Search Configured

When Azure Search is configured, the provider:
1. Sends queries to Azure OpenAI with `data_sources` parameter
2. Azure OpenAI queries your Azure Search index for relevant information
3. Returns responses grounded in the search results
4. Includes citations from the search results

Example response structure:
```json
{
  "content": "Response text with citations [doc1]",
  "citations": [
    {
      "content": "Citation content",
      "title": "Document Title",
      "url": "https://example.com/doc",
      "filepath": "doc.pdf"
    }
  ]
}
```

### Without Azure Search

If Azure Search is not configured, the provider:
1. Uses standard Azure OpenAI chat completions
2. Returns responses without web grounding
3. No citations included
4. Still fully functional for general queries

## Setup Instructions

### 1. Azure OpenAI Setup

1. Create an Azure OpenAI resource in Azure Portal
2. Deploy a GPT-4 model (recommended) or GPT-3.5-turbo
3. Copy the API key and endpoint
4. Add to your `.env` file

### 2. Azure Search Setup (Optional)

For web search capabilities:

1. Create an Azure Cognitive Search resource
2. Create a search index with your content
3. Ensure the index has fields:
   - `content` - Main text content
   - `title` - Document title
   - `url` - Source URL
   - `filepath` - File path (optional)
4. Copy the Search endpoint, index name, and API key
5. Add to your `.env` file

### 3. Verify Configuration

Run the debug endpoint to verify your setup:

```bash
curl http://localhost:3000/api/debug-providers
```

Look for:
```json
{
  "AzureOpenAISearchProvider": "✅ Success",
  "azureSearchConfigured": true
}
```

## Migration from ChatGPT Search

The system has been automatically updated to use Azure OpenAI Search instead of ChatGPT Search:

### What Changed

- API route `/api/user-query` now uses `azure-openai-search` provider
- Response format remains compatible (uses same `annotations` structure)
- UI components automatically updated to handle new provider
- Analytics continue to work with the new provider

### Backward Compatibility

- Old ChatGPT Search provider still available if needed
- Can run both providers simultaneously for testing
- Response format is compatible between providers

## Pricing Considerations

### Azure OpenAI Costs

- Input tokens: ~$0.03 per 1K tokens (GPT-4)
- Output tokens: ~$0.06 per 1K tokens (GPT-4)
- Pricing varies by model and region

### Azure Search Costs

- Based on search tier and query volume
- Typical: $0.10 per 1000 queries (Standard S1)
- Additional premium for web search: ~$0.01 per query

### Comparison to ChatGPT Search

Azure OpenAI + Azure Search costs are comparable to ChatGPT Search but provide:
- More control over data sources
- Integration with your existing Azure infrastructure
- Compliance with your organization's data policies

## Troubleshooting

### Provider Not Available

**Error:** "Azure OpenAI Search provider not available"

**Solution:**
1. Check that `AZURE_OPENAI_SEARCH_API_KEY` or `AZURE_OPENAI_API_KEY` is set
2. Verify the key is valid
3. Restart your Next.js development server

### No Citations Returned

**Issue:** Responses work but no citations included

**Solution:**
1. Verify Azure Search is configured (check console logs on startup)
2. Ensure search index exists and has content
3. Check that index has required fields: `content`, `title`, `url`

### Web Search Not Working

**Issue:** `webSearchUsed: false` even with Azure Search configured

**Possible causes:**
1. Azure Search API key is invalid
2. Search index is empty
3. Query doesn't match any indexed content

**Solution:**
1. Test Azure Search endpoint directly
2. Verify index has documents
3. Check index schema matches expected fields

## Testing

### Test Without Azure Search

Set only the Azure OpenAI variables and test:

```bash
curl -X POST http://localhost:3000/api/user-query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"query": "What is artificial intelligence?"}'
```

Expected: Response without citations, `webSearchUsed: false`

### Test With Azure Search

Set all Azure Search variables and test:

```bash
curl -X POST http://localhost:3000/api/user-query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -d '{"query": "What is artificial intelligence?"}'
```

Expected: Response with citations, `webSearchUsed: true`

## Support

For issues or questions:
1. Check the console logs for detailed error messages
2. Use `/api/debug-providers` endpoint to verify configuration
3. Review Azure OpenAI and Azure Search service health in Azure Portal

## References

- [Azure OpenAI Documentation](https://learn.microsoft.com/en-us/azure/ai-services/openai/)
- [Azure Cognitive Search Documentation](https://learn.microsoft.com/en-us/azure/search/)
- [Azure OpenAI with Your Data](https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/use-your-data)
