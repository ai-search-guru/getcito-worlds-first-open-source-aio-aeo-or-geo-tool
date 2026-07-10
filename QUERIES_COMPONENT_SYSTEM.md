# Queries Component System Documentation

## Overview

The Queries Component System provides a flexible, reusable set of React components for displaying and managing AI query data across the V8 Dashboard application. The system is designed with modularity and reusability in mind, allowing the same components to be used in different contexts with varying configurations.

## Architecture

### Core Components

1. **QueriesOverview** - Main component with full functionality
2. **QueriesWidget** - Compact widget for sidebars and small spaces
3. **QueriesContent** - Full-page implementation using QueriesOverview

### Key Features

- **Processing Session Tracking** - Timestamps and unique IDs for each processing session
- **Real-time Updates** - Live progress tracking during query processing
- **Flexible Variants** - Multiple display modes for different use cases
- **Interactive Elements** - Clickable queries, processing buttons, navigation
- **Responsive Design** - Works across different screen sizes
- **Category Filtering** - Filter queries by intent category
- **Search Functionality** - Text-based query searching

## Props Reference

### QueriesOverview Props

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `variant` | `'full' \| 'compact' \| 'minimal'` | `'compact'` | Display variant determining features and sizing |
| `layout` | `'cards' \| 'table'` | `'cards'` | Layout type - cards for dashboard widgets or table for detailed views |
| `maxQueries` | `number` | `5` | Maximum number of queries to display (ignored in full variant) |
| `showProcessButton` | `boolean` | `true` | Whether to show the process queries button |
| `showSearch` | `boolean` | `false` | Whether to show the search input |
| `showEyeIcons` | `boolean` | `true` | Whether to show status indicators and action icons |
| `showCategoryFilter` | `boolean` | `true` | Whether to show category filter buttons |
| `brandOverride` | `UserBrand` | `undefined` | Override selected brand (useful for specific contexts) |
| `className` | `string` | `''` | Additional CSS classes |
| `onViewAll` | `() => void` | `undefined` | Callback for "View All" action |
| `onQueryClick` | `(query, result) => void` | `undefined` | Callback for individual query interactions |

## Component Reference

### QueriesOverview

The primary queries component with full functionality.

#### Props

```typescript
interface QueriesOverviewProps {
  variant?: 'full' | 'compact' | 'minimal';
  maxQueries?: number;
  showProcessButton?: boolean;
  showSearch?: boolean;
  showEyeIcons?: boolean;
  showCategoryFilter?: boolean;
  brandOverride?: UserBrand;
  className?: string;
  onViewAll?: () => void;
  onQueryClick?: (query: any, result: any) => void;
}
```

#### Variants

**Full Variant**
- Complete interface with all features
- Suitable for dedicated pages
- Shows unlimited queries (with pagination)
- Includes search, filtering, and processing controls

**Compact Variant**
- Dashboard-friendly size
- Limited query display (configurable)
- Includes essential features
- Good for overview sections

**Minimal Variant**
- Ultra-compact display
- Minimal features
- Perfect for widgets and small spaces

#### Usage Examples

```tsx
// Full page implementation
<QueriesOverview 
  variant="full"
  showSearch={true}
  showCategoryFilter={true}
  showProcessButton={true}
  onQueryClick={handleQueryClick}
/>

// Dashboard overview
<QueriesOverview 
  variant="compact"
  maxQueries={5}
  showSearch={false}
  onViewAll={() => navigate('/queries')}
/>

// Minimal widget
<QueriesOverview 
  variant="minimal"
  maxQueries={3}
  showProcessButton={false}
  showEyeIcons={true}
/>
```

### QueriesWidget

Ultra-compact widget perfect for sidebars and constrained spaces.

#### Props

```typescript
interface QueriesWidgetProps {
  brandOverride?: UserBrand;
  onViewAll?: () => void;
  className?: string;
}
```

#### Features

- Processing statistics (total/processed counts)
- Progress bar visualization
- Last processed date
- Recent queries preview
- Quick navigation button

#### Usage Examples

```tsx
// Sidebar widget
<QueriesWidget 
  onViewAll={() => navigate('/dashboard/queries')}
  className="w-64"
/>

// Styled widget
<QueriesWidget 
  className="bg-gradient-to-br from-blue-50 to-purple-50"
/>
```

## Layout Types

### Cards Layout (Default)
- **Best for:** Dashboard widgets, compact displays, overview screens
- **Features:** Card-based UI, responsive design, space-efficient
- **Display:** Query cards with category badges, keywords, and processing status

### Table Layout
- **Best for:** Detailed data management, comprehensive analysis, administrative views
- **Features:** Tabular data display with sortable columns, comprehensive information
- **Columns:**
  - **Queries:** Full query text with processing timestamps
  - **Status:** Current query status (Active/Inactive)
  - **Topic:** Associated keyword/topic
  - **Platform:** AI platform availability indicators (ChatGPT, Google AIO, Perplexity)
  - **Intent:** Marketing funnel category (Awareness, Interest, Consideration, Purchase)
  - **Mentions:** Platform-specific mention tracking (future functionality)
  - **Citations:** Platform-specific citation tracking (future functionality)
  - **Actions:** View responses and other query actions

```tsx
// Table layout example
<QueriesOverview 
  variant="full"
  layout="table"
  showSearch={true}
  showCategoryFilter={true}
  onQueryClick={(query, result) => {
    // Handle query interaction
    console.log('Query clicked:', query.query);
  }}
/>
```

## Component Variants

## Integration Guide

### Dashboard Integration

Add to main dashboard page:

```tsx
import QueriesOverview from '@/components/features/QueriesOverview';

// In your dashboard component
<QueriesOverview 
  variant="compact"
  maxQueries={5}
  showProcessButton={true}
  showSearch={false}
  onViewAll={() => router.push('/dashboard/queries')}
/>
```

### Dedicated Queries Page

Replace existing queries page content:

```tsx
import QueriesOverview from '@/components/features/QueriesOverview';

export default function QueriesPage() {
  return (
    <DashboardLayout title="Queries">
      <QueriesOverview 
        variant="full"
        showSearch={true}
        showCategoryFilter={true}
        showProcessButton={true}
        onQueryClick={handleQueryClick}
      />
    </DashboardLayout>
  );
}
```

### Sidebar Widget

Add to sidebar or navigation:

```tsx
import QueriesWidget from '@/components/features/QueriesWidget';

// In sidebar component
<QueriesWidget 
  onViewAll={() => router.push('/dashboard/queries')}
/>
```

## Data Flow

### Processing Session Management

Each query processing session generates:
- **processingSessionId**: Unique identifier (`session_1234567890_abc123`)
- **processingSessionTimestamp**: ISO timestamp when session started

This allows tracking of different analysis runs over time and comparison of results.

### Real-time Updates

1. User clicks "Process Queries"
2. Component generates processing session ID
3. Queries processed individually with live progress updates
4. Results saved incrementally to Firestore
5. Local state updates provide immediate UI feedback
6. Final refresh syncs with server state

### State Management

- **Local State**: Live processing results, UI state
- **Context**: Selected brand, brand list
- **Firestore**: Persistent query results with session tracking
- **Memoization**: Optimized re-renders with useMemo

## Customization

### Styling

Components use Tailwind CSS with design system variables:

```css
--color-primary: #000C60
--color-secondary: #00B087
--color-accent: #764F94
```

### Theming

All components respect the global theme context:
- Light/dark mode support
- Consistent color palette
- Responsive typography

### Brand Override

Display queries for specific brands:

```tsx
<QueriesOverview 
  brandOverride={specificBrand}
  variant="compact"
/>
```

## Performance Considerations

### Optimizations

- **useMemo** for expensive calculations
- **useCallback** for event handlers
- **Conditional rendering** for large lists
- **Debounced search** to reduce API calls

### Best Practices

1. Use appropriate variant for context
2. Limit maxQueries for performance
3. Implement proper error boundaries
4. Use brand override sparingly
5. Cache query results when possible

## Testing

### Component Testing

```tsx
import { render, screen } from '@testing-library/react';
import QueriesOverview from '@/components/features/QueriesOverview';

test('renders queries overview', () => {
  render(<QueriesOverview variant="compact" />);
  expect(screen.getByText('Queries Overview')).toBeInTheDocument();
});
```

### Integration Testing

- Test processing workflow end-to-end
- Verify session tracking functionality
- Check cross-component communication
- Validate responsive behavior

## Migration Guide

### From Legacy Queries Component

1. Replace imports:
```tsx
// Old
import QueriesContent from './queries-content';

// New
import QueriesOverview from '@/components/features/QueriesOverview';
```

2. Update props:
```tsx
// Old
<QueriesContent brandId={brandId} />

// New
<QueriesOverview 
  variant="full"
  brandOverride={brand}
/>
```

3. Handle callbacks:
```tsx
// Old
<QueriesContent onQuerySelect={handleSelect} />

// New
<QueriesOverview 
  onQueryClick={(query, result) => handleSelect(result)}
/>
```

## Troubleshooting

### Common Issues

**Hooks Error**: Ensure hooks are called consistently
- Solution: Move all hooks before conditional returns

**Infinite Re-renders**: Check useMemo dependencies
- Solution: Memoize expensive calculations properly

**Missing Data**: Verify brand context
- Solution: Ensure brand is selected or use brandOverride

**Processing Errors**: Check session tracking
- Solution: Verify processingSessionId generation

### Debug Tools

Enable development mode debug information:

```tsx
// Set NODE_ENV=development for debug logs
console.log('🔍 Queries debug:', {
  brand: selectedBrand?.companyName,
  queries: queries.length,
  results: queryResults.length
});
```

## Future Enhancements

### Planned Features

- [ ] Pagination for large query lists
- [ ] Bulk query operations
- [ ] Export functionality
- [ ] Advanced filtering options
- [ ] Query templates
- [ ] Performance analytics
- [ ] A/B testing for queries

### Extension Points

- Custom query processors
- Additional AI providers
- Custom result formats
- Third-party integrations
- Advanced visualizations

## Support

For questions or issues:
1. Check this documentation
2. Review component props and examples
3. Use browser dev tools for debugging
4. Check console for error messages
5. Verify brand context and data flow 