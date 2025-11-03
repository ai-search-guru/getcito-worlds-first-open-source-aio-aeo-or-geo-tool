# Brand Context Usage Guide

## Overview

The `BrandContext` provides a centralized way to manage the currently selected brand across all dashboard pages. It combines React Context API with localStorage for persistence and automatic state management.

## Features

- **Global State**: Selected brand is available across all dashboard pages
- **Persistence**: Selection persists across page refreshes via localStorage
- **Auto-selection**: Automatically selects the first brand when user has brands
- **Validation**: Ensures selected brand still exists in user's brands
- **Loading States**: Handles loading and error states from brand fetching

## Setup

The `BrandContextProvider` is already configured in `DashboardLayout.tsx`, so all dashboard pages automatically have access to the brand context.

## Usage in Components

### Basic Usage

```typescript
import { useBrandContext } from '@/context/BrandContext';

function MyDashboardPage() {
  const { selectedBrand, selectedBrandId, brands, setSelectedBrandId } = useBrandContext();

  // selectedBrand contains the full brand object
  // selectedBrandId contains just the ID string
  // brands contains all user's brands
  // setSelectedBrandId allows changing the selection

  return (
    <div>
      {selectedBrand ? (
        <h1>Dashboard for {selectedBrand.companyName}</h1>
      ) : (
        <p>No brand selected</p>
      )}
    </div>
  );
}
```

### Available Properties

```typescript
interface BrandContextType {
  selectedBrand: UserBrand | null;      // Complete brand object
  selectedBrandId: string | null;       // Just the brand ID
  brands: UserBrand[];                  // All user's brands
  setSelectedBrandId: (id: string) => void; // Change selection
  loading: boolean;                     // Loading state
  error: string | null;                 // Error state
}
```

### UserBrand Interface

```typescript
interface UserBrand {
  id: string;
  userId: string;
  domain: string;
  companyName: string;
  shortDescription?: string;
  productsAndServices?: string[];
  keywords?: string[];
  queries?: Array<{...}>;
  createdAt: string;
  updatedAt: string;
  // ... other properties
}
```

## Examples

### 1. Display Brand-Specific Data

```typescript
function AnalyticsPage() {
  const { selectedBrand, loading } = useBrandContext();

  if (loading) return <div>Loading...</div>;
  if (!selectedBrand) return <div>No brand selected</div>;

  return (
    <div>
      <h1>Analytics for {selectedBrand.companyName}</h1>
      <p>Domain: {selectedBrand.domain}</p>
      <p>Keywords: {selectedBrand.keywords?.join(', ')}</p>
      {/* Your analytics components here */}
    </div>
  );
}
```

### 2. Filter Data by Selected Brand

```typescript
function CompetitorsPage() {
  const { selectedBrandId } = useBrandContext();

  // Use selectedBrandId to filter data
  const { data: competitors } = useCompetitors(selectedBrandId);

  return (
    <div>
      {competitors.map(competitor => (
        <CompetitorCard key={competitor.id} competitor={competitor} />
      ))}
    </div>
  );
}
```

### 3. Brand Switching

```typescript
function BrandSwitcher() {
  const { brands, selectedBrandId, setSelectedBrandId } = useBrandContext();

  return (
    <select 
      value={selectedBrandId || ''} 
      onChange={(e) => setSelectedBrandId(e.target.value)}
    >
      {brands.map(brand => (
        <option key={brand.id} value={brand.id}>
          {brand.companyName}
        </option>
      ))}
    </select>
  );
}
```

### 4. Conditional Rendering Based on Brand

```typescript
function DashboardPage() {
  const { selectedBrand, brands } = useBrandContext();

  if (brands.length === 0) {
    return <EmptyState message="Add your first brand to get started" />;
  }

  if (!selectedBrand) {
    return <LoadingState />;
  }

  return (
    <div>
      <BrandHeader brand={selectedBrand} />
      <MetricsSection brandId={selectedBrand.id} />
      <AnalyticsSection brandId={selectedBrand.id} />
    </div>
  );
}
```

## API Integration

When making API calls that need brand-specific data, use the `selectedBrandId`:

```typescript
function useAnalyticsData() {
  const { selectedBrandId } = useBrandContext();

  return useQuery({
    queryKey: ['analytics', selectedBrandId],
    queryFn: () => fetchAnalytics(selectedBrandId),
    enabled: !!selectedBrandId, // Only fetch when brand is selected
  });
}
```

## Best Practices

1. **Always check for selectedBrand/selectedBrandId** before using the data
2. **Use loading states** to provide better UX while brands are being fetched
3. **Handle empty states** when user has no brands
4. **Use selectedBrandId for API calls** and selectedBrand for display data
5. **Don't modify the brands array directly** - it's managed by the context

## Migration from Local State

If you have existing components that manage brand selection locally:

### Before
```typescript
function MyComponent() {
  const [selectedBrandId, setSelectedBrandId] = useState<string | null>(null);
  const { brands } = useUserBrands();
  
  // ... component logic
}
```

### After
```typescript
function MyComponent() {
  const { selectedBrandId, setSelectedBrandId, brands } = useBrandContext();
  
  // ... component logic (same, but no local state needed)
}
```

## Troubleshooting

### Brand selection not persisting
- Check that localStorage is available in your environment
- Ensure the component is wrapped in `BrandContextProvider`

### selectedBrand is null but brands exist
- This usually happens during initial load - add loading checks
- Verify the selectedBrandId exists in the brands array

### Context not available error
- Ensure your component is inside the `DashboardLayout` or wrapped in `BrandContextProvider`
- Check the import path: `@/context/BrandContext` 