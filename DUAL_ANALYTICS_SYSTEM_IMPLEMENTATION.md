# Dual Analytics System Implementation

## Overview

The brand analytics system has been enhanced to provide **two distinct types of analytics**:

1. **Latest Performance**: Session-based analytics from the most recent query processing session
2. **Lifetime Analytics**: Cumulative analytics across ALL historical queries ever processed for a brand

This addresses the limitation where analytics only showed a snapshot of current queries rather than comprehensive brand performance over time.

## System Architecture

### Data Sources

#### Latest Performance (Session-Based)
- **Source**: `v8_user_brand_analytics` collection
- **Scope**: Single processing session (current implementation)
- **Updates**: Real-time during query processing
- **Use Case**: Recent performance insights, session comparisons

#### Lifetime Analytics (Historical Aggregate)
- **Sources**: Multiple collections (fault-tolerant)
  - Primary: `queryProcessingResults` array in brand document
  - Secondary: `v8userqueries` collection (legacy data)
  - Future: `v8detailed_query_results` collection
- **Scope**: All queries ever processed for the brand
- **Updates**: Calculated on-demand
- **Use Case**: Overall brand performance, long-term trends

### Implementation Details

## New Interfaces

### LifetimeBrandAnalytics
```typescript
interface LifetimeBrandAnalytics {
  userId: string;
  brandId: string;
  brandName: string;
  brandDomain: string;
  
  // Lifetime aggregated metrics
  totalQueriesProcessed: number;
  totalProcessingSessions: number;
  totalBrandMentions: number;
  brandVisibilityScore: number;
  totalCitations: number;
  totalDomainCitations: number;
  
  // Provider-specific lifetime data
  providerStats: {
    chatgpt: { queriesProcessed, brandMentions, citations, domainCitations, averageResponseTime? };
    google: { queriesProcessed, brandMentions, citations, domainCitations, averageResponseTime? };
    perplexity: { queriesProcessed, brandMentions, citations, domainCitations, averageResponseTime? };
  };
  
  // Lifetime insights
  insights: {
    topPerformingProvider: string;
    topProviders: string[];
    averageBrandMentionsPerQuery: number;
    averageCitationsPerQuery: number;
    firstQueryProcessed?: string;
    lastQueryProcessed?: string;
    providerRankingDetails?: { [provider: string]: { rank, brandMentions, domainCitationsRatio, totalCitations } };
  };
  
  calculatedAt: any;
}
```

## Key Functions

### calculateLifetimeBrandAnalytics()
**Location**: `src/firebase/firestore/brandAnalytics.ts`

**Features**:
- **Fault-tolerant data collection** from multiple sources
- **Legacy data conversion** from old query formats
- **Session deduplication** to avoid counting queries multiple times
- **Comprehensive aggregation** using existing analytics logic
- **Graceful fallbacks** when data sources are unavailable

**Data Collection Strategy**:
```typescript
// 1. Get current session results from brand document
if (brand.queryProcessingResults?.length > 0) {
  allQueryResults.push(...brand.queryProcessingResults);
}

// 2. Try to get historical results from v8userqueries (fault-tolerant)
try {
  const historicalQueriesResult = await getQueriesByBrand(brandId);
  // Convert legacy format to current format
} catch (error) {
  console.warn('⚠️ Could not fetch historical queries (fault-tolerant):', error);
  // Continue without historical data
}
```

### Enhanced UI Components

#### BrandAnalyticsDisplay
**Location**: `src/components/features/BrandAnalyticsDisplay.tsx`

**Features**:
- **Dual Section Display**: Latest Performance (🔵) and Lifetime Analytics (🟢)
- **Conditional Rendering**: Shows sections based on available data
- **Enhanced Provider Rankings**: Multi-criteria ranking with tie handling
- **Context-Aware Information**: Session details vs. lifetime spans

#### Updated Hooks
- `useLatestBrandAnalytics()`: Session-based analytics
- `useLifetimeBrandAnalytics()`: Historical analytics  
- `useBrandAnalyticsCombined()`: Both analytics types

### Analytics Page Integration
**Location**: `src/app/dashboard/analytics/page.tsx`

Uses `useBrandAnalyticsCombined()` to display both analytics sections when available.

## Fault Tolerance Features

### Legacy Data Conversion
```typescript
// Convert historical query format to current format
query.aiResponses.forEach(response => {
  const provider = response.provider.toLowerCase();
  if (provider.includes('openai') || provider.includes('chatgpt')) {
    result.results.chatgpt = {
      response: response.response || '',
      error: response.error,
      timestamp: response.timestamp || result.date,
      responseTime: response.responseTime
    };
  }
  // ... other providers
});
```

### Error Handling
- Try-catch blocks around data collection
- Warning logs for missing data sources
- Graceful degradation when historical data unavailable
- Session deduplication to prevent double-counting

### Multiple Data Source Support
1. **Primary**: `queryProcessingResults` in brand document
2. **Secondary**: `v8userqueries` collection (legacy)
3. **Future**: `v8detailed_query_results` collection

## Enhanced Provider Ranking System

### Multi-Criteria Ranking
1. **Primary**: Brand mentions (highest wins)
2. **Secondary**: Domain citations ratio (domain citations / total citations)
3. **Tertiary**: Total citations
4. **Tie Handling**: Multiple providers shown as "ChatGPT & Perplexity"

### Performance Validation
- Requires at least 1 brand mention OR 1 domain citation for meaningful ranking
- Shows "None" when no brand performance exists
- Prevents arbitrary rankings without actual brand visibility

## Troubleshooting

### Common Issues

#### "Brand not found" Error
**Problem**: `calculateLifetimeBrandAnalytics()` throwing "Brand not found" error

**Root Cause**: Function was incorrectly calling `getUserBrands('', brandId)` which expects a `userId` parameter, not `brandId`

**Fix**: Updated to use `getBrandInfo(brandId)` from `brandDataService.ts`

```typescript
// ❌ Before (incorrect)
const brandResult = await getUserBrands('', brandId);
if (!brandResult.result || brandResult.result.length === 0) {
  return { error: 'Brand not found' };
}
const brand = brandResult.result[0];

// ✅ After (correct)  
const brand = await getBrandInfo(brandId);
if (!brand) {
  return { error: 'Brand not found' };
}
```

**Files Changed**:
- `src/firebase/firestore/brandAnalytics.ts`: Fixed import and function call
- Updated import from `getUserBrands` to `getBrandInfo`

### Data Validation
- Empty query results return zero-initialized analytics
- Legacy data format conversion with error handling
- Session ID validation to prevent duplicates

## Testing Guidelines

### Manual Testing
1. **Latest Performance**: Process queries and verify real-time analytics updates
2. **Lifetime Analytics**: Navigate to analytics page and verify historical data aggregation
3. **Provider Rankings**: Test with various brand mention scenarios
4. **Error Handling**: Test with brands that have no query history

### Edge Cases
- Brands with no processed queries
- Legacy data format compatibility
- Multiple processing sessions
- Tied provider performance
- Missing brand mentions or domain citations

## Future Enhancements

### Planned Features
- **Trend Analysis**: Compare lifetime vs. recent performance
- **Competitor Analysis**: Track competitor mentions in responses
- **Performance Alerts**: Notify when brand visibility changes significantly
- **Export Functionality**: Download analytics reports
- **Advanced Filtering**: Filter by date ranges, providers, query categories

### Data Structure Evolution
- Migration to `v8detailed_query_results` collection for better performance
- Enhanced session tracking with metadata
- Provider response quality metrics
- Cost tracking per query/session 