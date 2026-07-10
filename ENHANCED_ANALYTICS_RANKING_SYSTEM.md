# Enhanced Analytics Ranking System

## Overview

The brand analytics system has been enhanced with a sophisticated **multi-criteria ranking system** for determining top performing providers. Instead of simply looking at brand mentions, the system now uses a hierarchical ranking approach that considers multiple performance factors.

## Ranking Criteria (in order of priority)

### 0. **Prerequisite: Meaningful Performance**
- **REQUIRED**: At least 1 brand mention OR 1 domain citation across all providers
- If no brand mentions AND no domain citations → Top Provider = "None"
- This prevents arbitrary ranking when there's no actual brand performance

### 1. **Primary Criterion: Brand Mentions**
- Total number of brand mentions across all queries
- Higher brand mentions = better ranking

### 2. **Secondary Criterion: Domain Citations Ratio**
- Calculated as: `domain citations / total citations`
- Expressed as percentage (e.g., 75.5%)
- Used as tiebreaker when brand mentions are equal
- Higher ratio = better ranking (indicates more relevant citations)

### 3. **Tertiary Criterion: Total Citations**
- Total number of citations found
- Used as final tiebreaker when both brand mentions and domain citation ratios are equal
- Higher total citations = better ranking

## Implementation Details

### Enhanced Analytics Interface

```typescript
interface BrandAnalyticsData {
  insights: {
    topPerformingProvider: string; // "chatgpt" or "chatgpt & perplexity" for ties
    topProviders: string[]; // ["chatgpt", "perplexity"] for ties
    providerRankingDetails: {
      [provider: string]: {
        rank: number;
        brandMentions: number;
        domainCitationsRatio: number; // Percentage (0-100)
        totalCitations: number;
      };
    };
    // ... other insights
  };
}
```

### Ranking Algorithm

```typescript
// 0. Check for meaningful brand performance
const hasBrandPerformance = totalBrandMentions > 0 || totalDomainCitations > 0;

if (!hasBrandPerformance) {
  topPerformingProvider = 'none';
  topProviders = [];
} else {
  // 1. Filter providers that processed queries
  const providerRankings = Object.entries(providerStats)
    .filter(([_, stats]) => stats.queriesProcessed > 0)
    .map(([provider, stats]) => ({
      provider,
      brandMentions: stats.brandMentions,
      domainCitationsRatio: stats.citations > 0 ? stats.domainCitations / stats.citations : 0,
      totalCitations: stats.citations,
      domainCitations: stats.domainCitations
    }));

  // 2. Sort by multiple criteria
  providerRankings.sort((a, b) => {
    // Primary: Brand mentions
    if (a.brandMentions !== b.brandMentions) {
      return b.brandMentions - a.brandMentions;
    }
    
    // Secondary: Domain citations ratio
    if (Math.abs(a.domainCitationsRatio - b.domainCitationsRatio) > 0.001) {
      return b.domainCitationsRatio - a.domainCitationsRatio;
    }
    
    // Tertiary: Total citations
    return b.totalCitations - a.totalCitations;
  });

  // 3. Validate top provider has meaningful performance
  const topProvider = providerRankings[0];
  const topProviderHasPerformance = topProvider.brandMentions > 0 || topProvider.domainCitations > 0;
  
  if (!topProviderHasPerformance) {
    topPerformingProvider = 'none';
    topProviders = [];
  } else {
    // 4. Handle ties (only among providers with actual performance)
    const tiedProviders = providerRankings.filter(p => 
      p.brandMentions === topProvider.brandMentions && 
      Math.abs(p.domainCitationsRatio - topProvider.domainCitationsRatio) < 0.001 &&
      (p.brandMentions > 0 || p.domainCitations > 0)
    );

    if (tiedProviders.length > 1) {
      topPerformingProvider = tiedProviders.map(p => p.provider).join(' & ');
      topProviders = tiedProviders.map(p => p.provider);
    } else {
      topPerformingProvider = topProvider.provider;
      topProviders = [topProvider.provider];
    }
  }
}
```

## Example Ranking Scenarios

### Scenario 0: No Meaningful Performance
```
ChatGPT:    0 brand mentions, 0% domain ratio, 15 total citations
Google AI:  0 brand mentions, 0% domain ratio, 12 total citations
Perplexity: 0 brand mentions, 0% domain ratio, 8 total citations

Result: "None" (no brand mentions or domain citations)
```

### Scenario 1: Clear Winner
```
ChatGPT:    5 brand mentions, 80% domain ratio, 20 total citations
Google AI:  3 brand mentions, 90% domain ratio, 15 total citations
Perplexity: 2 brand mentions, 75% domain ratio, 18 total citations

Result: ChatGPT wins (highest brand mentions)
```

### Scenario 2: Brand Mentions Tie, Domain Ratio Decides
```
ChatGPT:    5 brand mentions, 60% domain ratio, 20 total citations
Google AI:  5 brand mentions, 80% domain ratio, 15 total citations
Perplexity: 3 brand mentions, 90% domain ratio, 10 total citations

Result: Google AI wins (tied brand mentions, higher domain ratio)
```

### Scenario 3: Complete Tie
```
ChatGPT:    5 brand mentions, 75% domain ratio, 20 total citations
Perplexity: 5 brand mentions, 75% domain ratio, 18 total citations
Google AI:  3 brand mentions, 80% domain ratio, 15 total citations

Result: "ChatGPT & Perplexity" (tied on first two criteria)
```

### Scenario 4: All Criteria Tied
```
ChatGPT:    5 brand mentions, 75% domain ratio, 20 total citations
Perplexity: 5 brand mentions, 75% domain ratio, 20 total citations
Google AI:  3 brand mentions, 80% domain ratio, 15 total citations

Result: "ChatGPT & Perplexity" (completely tied performance)
```

### Scenario 5: Only Citations, No Brand Performance
```
ChatGPT:    0 brand mentions, 0% domain ratio, 25 total citations
Google AI:  0 brand mentions, 0% domain ratio, 30 total citations
Perplexity: 0 brand mentions, 0% domain ratio, 20 total citations

Result: "None" (citations exist but no brand mentions or domain citations)
```

## UI Enhancements

### Top Provider Display

**Single Winner:**
```
🏆 Top Provider
[ChatGPT Icon] ChatGPT
```

**Multiple Winners (Tied):**
```
🏆 Top Providers
[ChatGPT Icon] & [Perplexity Icon]
Tied performance
```

**No Meaningful Performance:**
```
🏆 Top Provider
[?] None
No brand mentions or domain citations found
```

### Provider Performance Cards

Each provider card now shows:
- **Rank badge**: `#1`, `#2`, `#3`
- **Top performer indicator**: 🏆 icon for winners
- **Domain citations ratio**: `75.5%` (new metric)
- **Enhanced styling**: Orange background for top performers

### Provider Ranking Details

```typescript
providerRankingDetails: {
  "chatgpt": {
    rank: 1,
    brandMentions: 5,
    domainCitationsRatio: 75.5,
    totalCitations: 20
  },
  "perplexity": {
    rank: 2,
    brandMentions: 3,
    domainCitationsRatio: 80.0,
    totalCitations: 15
  },
  "google": {
    rank: 3,
    brandMentions: 2,
    domainCitationsRatio: 90.0,
    totalCitations: 10
  }
}
```

## Benefits

### 1. **More Accurate Performance Assessment**
- Brand mentions show direct brand visibility
- Domain citations ratio shows relevance quality
- Total citations show overall engagement

### 2. **Fair Tiebreaking**
- Multiple criteria prevent arbitrary rankings
- Recognizes different types of performance excellence
- Handles edge cases gracefully

### 3. **Better User Insights**
- Users understand why a provider ranks higher
- Clear visibility into performance metrics
- Transparent ranking methodology

### 4. **Tie Recognition**
- Properly acknowledges when providers perform equally
- Shows multiple top performers when appropriate
- Avoids false precision in rankings

## Technical Features

### 1. **Floating Point Precision**
- Uses epsilon comparison (0.001) for domain citation ratios
- Prevents floating point precision issues
- Ensures consistent tie detection

### 2. **Incremental Updates**
- Ranking recalculated after each query
- Real-time ranking updates during processing
- Consistent with incremental analytics system

### 3. **Backward Compatibility**
- `topPerformingProvider` field maintained for existing code
- New `topProviders` array for enhanced functionality
- Optional `providerRankingDetails` for detailed insights

### 4. **Error Handling**
- Gracefully handles providers with no queries processed
- Handles division by zero for citation ratios
- Provides sensible defaults for edge cases

## Usage Examples

### Accessing Top Providers
```typescript
// Single top provider (backward compatible)
const topProvider = analytics.insights.topPerformingProvider; // "chatgpt"

// Multiple top providers (new)
const topProviders = analytics.insights.topProviders; // ["chatgpt", "perplexity"]

// Check for ties
const isTied = topProviders.length > 1;

// Get ranking details
const chatgptRank = analytics.insights.providerRankingDetails?.chatgpt?.rank; // 1
const chatgptRatio = analytics.insights.providerRankingDetails?.chatgpt?.domainCitationsRatio; // 75.5
```

### UI Conditional Rendering
```tsx
{analytics.insights.topProviders.length > 1 ? (
  <div>
    <span>Top Providers: </span>
    {analytics.insights.topProviders.map(provider => (
      <ProviderIcon key={provider} provider={provider} />
    ))}
    <span>Tied performance</span>
  </div>
) : (
  <div>
    <span>Top Provider: </span>
    <ProviderIcon provider={analytics.insights.topPerformingProvider} />
  </div>
)}
```

## Future Enhancements

1. **Weighted Scoring**: Allow custom weights for different criteria
2. **Response Time Factor**: Include average response time in ranking
3. **Quality Scoring**: Factor in response quality metrics
4. **Historical Trends**: Show ranking changes over time
5. **Custom Ranking**: Allow users to define their own ranking criteria

## Conclusion

This enhanced ranking system provides a more nuanced and accurate assessment of provider performance, moving beyond simple brand mention counts to consider the quality and relevance of citations. The system properly handles ties and provides detailed insights into why providers rank as they do, giving users better visibility into their brand's performance across different AI platforms. 