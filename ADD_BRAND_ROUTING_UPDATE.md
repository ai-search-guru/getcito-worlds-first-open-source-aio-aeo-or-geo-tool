# Add Brand Button Routing Update

## Overview
Updated all "Add Brand" buttons across the application to point to `/dashboard/add-brand/step-1` instead of their previous destinations.

## Changes Made

### 1. Dashboard Page (`src/app/dashboard/page.tsx`)
- **Fixed**: Duplicate `Link` import issue by renaming lucide-react Link to `LinkIcon`
- **Updated**: Import to include `Link` from `next/link`
- **Updated**: "Add New Brand" button in Quick Actions section to use Link component
- **Changes**:
  ```tsx
  // Before: Plain button
  <button className="w-full text-left p-3 border border-border rounded-lg hover:border-accent transition-colors">
    <p className="text-foreground font-medium">Add New Brand</p>
    <p className="text-muted-foreground text-sm">Start tracking additional brands</p>
  </button>

  // After: Link component
  <Link href="/dashboard/add-brand/step-1" className="w-full text-left p-3 border border-border rounded-lg hover:border-accent transition-colors block">
    <p className="text-foreground font-medium">Add New Brand</p>
    <p className="text-muted-foreground text-sm">Start tracking additional brands</p>
  </Link>
  ```

### 2. Queries Page (`src/app/dashboard/queries/queries-content.tsx`)
- **Added**: `Link` import from `next/link`
- **Updated**: "Add Brand" button in empty state to use Link component
- **Target**: `/dashboard/add-brand/step-1`

### 3. Analytics Page (`src/app/dashboard/analytics/page.tsx`)
- **Added**: `Link` import from `next/link`
- **Updated**: "Add Brand" button in empty state to use Link component
- **Target**: `/dashboard/add-brand/step-1`

### 4. Competitors Page (`src/app/dashboard/competitors/page.tsx`)
- **Added**: `Link` import from `next/link`
- **Updated**: "Add Brand" button in empty state to use Link component
- **Target**: `/dashboard/add-brand/step-1`

### 5. Already Correct Components
These components were already pointing to the correct route:

#### Sidebar (`src/components/layout/Sidebar.tsx`)
- ✅ Navigation item: `{ name: 'Add Brand', href: '/dashboard/add-brand/step-1', icon: Plus }`
- ✅ Dropdown "Add Brand" option: `<Link href="/dashboard/add-brand/step-1">`

#### Header (`src/components/layout/Header.tsx`)
- ✅ Brand dropdown "Add Brand" option: `<Link href="/dashboard/add-brand/step-1">`
- ✅ Header "Add Brand" button: `<Link href="/dashboard/add-brand/step-1">`

## Summary
All "Add Brand" buttons throughout the application now consistently point to `/dashboard/add-brand/step-1`, providing a unified user experience where users are directed to the first step of the brand setup process regardless of where they click "Add Brand".

## User Flow Impact
- **New Users**: Sign up → Auto-redirect to `/dashboard/add-brand/step-1`
- **Existing Users**: Click any "Add Brand" button → Navigate to `/dashboard/add-brand/step-1`
- **Credit System**: Setup completion deducts 100 credits
- **Post-Setup**: Modal redirect to `/dashboard/queries` for immediate query management

## Testing Scenarios
1. ✅ Dashboard Quick Actions "Add New Brand" button
2. ✅ Sidebar navigation "Add Brand" item
3. ✅ Sidebar brand dropdown "Add Brand" option
4. ✅ Header brand dropdown "Add Brand" option
5. ✅ Header "Add Brand" button
6. ✅ Empty state "Add Brand" buttons (queries, analytics, competitors pages)

All routing now leads to the same destination: `/dashboard/add-brand/step-1` 