# BrandContext Testing Guide

## Overview

This guide provides comprehensive testing procedures to verify that `useBrandContext()` is working properly in your application.

## 🧪 Test Components Created

### 1. **Manual Test Utility** (`src/utils/testBrandContext.ts`)
A browser console utility for basic functionality testing.

### 2. **React Test Component** (`src/components/test/BrandContextTester.tsx`) 
A comprehensive React component that tests all BrandContext functionality.

### 3. **Test Page** (`src/app/dashboard/test-brand-context/page.tsx`)
A dedicated dashboard page for testing BrandContext integration.

## 🚀 Quick Testing Instructions

### Option 1: Use the Test Page (Recommended)
1. Navigate to `/dashboard/test-brand-context`
2. The page will automatically run tests and show results
3. Use the manual test buttons to verify brand selection
4. Check all test results and current context state

### Option 2: Browser Console Testing
1. Navigate to any dashboard page
2. Open browser Developer Tools (F12)
3. Go to Console tab
4. Copy and paste the manual test utility code
5. Run `testBrandContext()` function

### Option 3: Manual Testing Checklist
Follow the step-by-step checklist below for thorough testing.

## 📋 Complete Testing Checklist

### ✅ Prerequisites
- [ ] User is authenticated and logged in
- [ ] At least one brand has been added via the "Add Brand" flow
- [ ] Multiple brands available for selection testing (recommended)

### ✅ Core Functionality Tests

#### 1. **Context Provider Integration**
- [ ] BrandContext is accessible in dashboard pages
- [ ] No console errors about missing provider
- [ ] `useBrandContext()` hook returns expected values

#### 2. **Brand Loading**
- [ ] Brands load correctly from Firestore
- [ ] Loading states display properly
- [ ] Error states handle gracefully
- [ ] Empty state shows when no brands exist

#### 3. **Auto-Selection**
- [ ] First brand is automatically selected on initial load
- [ ] Auto-selection only happens when no previous selection exists
- [ ] Auto-selection respects localStorage preference

#### 4. **Manual Selection**
- [ ] Sidebar dropdown appears when multiple brands exist
- [ ] Single brand shows directly (no dropdown) when only one brand
- [ ] Brand selection updates immediately
- [ ] Selected brand appears highlighted/active in dropdown

#### 5. **Persistence**
- [ ] Selected brand saves to localStorage
- [ ] Selection persists across page refreshes
- [ ] Selection persists across navigation between dashboard pages
- [ ] Invalid stored selections fallback to first available brand

#### 6. **Data Integration**
- [ ] Dashboard data changes when brand selection changes
- [ ] API calls include correct `brandId` parameter
- [ ] Brand-specific data displays correctly
- [ ] Loading states during data fetching work properly

### ✅ Advanced Functionality Tests

#### 7. **Brand Validation**
- [ ] Context handles brand deletion gracefully
- [ ] Invalid selections reset to valid alternatives
- [ ] Brand list updates reflect in selection options

#### 8. **Error Handling**
- [ ] Network errors display appropriate messages
- [ ] Firestore errors don't break the interface
- [ ] Missing brands handled gracefully
- [ ] Authentication errors handled properly

#### 9. **Performance**
- [ ] Brand changes don't cause unnecessary re-renders
- [ ] Data fetching is efficient and not duplicated
- [ ] Context updates are batched appropriately

#### 10. **UI/UX Testing**
- [ ] Brand indicators display correctly
- [ ] WebLogo integration works for brand logos
- [ ] Hover states and transitions are smooth
- [ ] Mobile responsiveness works properly

## 🔍 Detailed Test Scenarios

### Scenario 1: New User Flow
1. **Setup**: New user, no brands added
2. **Expected**: 
   - No brand selected (`selectedBrandId = null`)
   - Empty state messages display
   - No sidebar brand section visible
3. **Test**: Add a brand through the flow
4. **Expected**: Brand auto-selects, sidebar appears

### Scenario 2: Single Brand User
1. **Setup**: User with exactly one brand
2. **Expected**:
   - Brand auto-selects
   - Sidebar shows brand directly (no dropdown)
   - All data specific to that brand
3. **Test**: Add second brand
4. **Expected**: Sidebar switches to dropdown format

### Scenario 3: Multi-Brand User
1. **Setup**: User with multiple brands
2. **Expected**:
   - Dropdown appears in sidebar
   - First brand selected by default
   - Can switch between brands
3. **Test**: Select different brands
4. **Expected**: Data updates, selection persists

### Scenario 4: Brand Deletion
1. **Setup**: User with multiple brands, one selected
2. **Test**: Delete the currently selected brand
3. **Expected**: 
   - Selection automatically switches to remaining brand
   - No errors or broken states
   - Data updates appropriately

### Scenario 5: Network Issues
1. **Test**: Disconnect network while brands are loading
2. **Expected**: Error state displays, graceful fallback
3. **Test**: Reconnect and refresh
4. **Expected**: Brands load normally

## 🛠️ Developer Testing Tools

### Browser DevTools Inspection

#### localStorage Check:
```javascript
// Check stored brand selection
localStorage.getItem('selectedBrandId')

// Manually set brand selection
localStorage.setItem('selectedBrandId', 'your-brand-id')
```

#### Network Monitoring:
1. Open Network tab in DevTools
2. Filter by "Fetch/XHR"
3. Change brand selection
4. Verify API calls include correct `brandId` parameter

#### React DevTools:
1. Install React DevTools extension
2. Find `BrandContextProvider` in component tree
3. Inspect context state values
4. Monitor state changes during brand selection

### Console Commands:
```javascript
// Test localStorage functionality
localStorage.setItem('test', 'value');
localStorage.getItem('test'); // Should return 'value'
localStorage.removeItem('test');

// Check if BrandContext is working
// (Run this in a dashboard page)
console.log('BrandContext available:', typeof useBrandContext === 'function');
```

## 🐛 Common Issues & Solutions

### Issue: "useBrandContext must be used within a BrandContextProvider"
**Solution**: Ensure the component is inside `DashboardLayout` or wrapped in `BrandContextProvider`

### Issue: Brand selection not persisting
**Solutions**:
- Check if localStorage is enabled in browser
- Verify no browser extensions are blocking localStorage
- Check for JavaScript errors preventing persistence

### Issue: Auto-selection not working
**Solutions**:
- Verify brands are loading correctly
- Check for loading states blocking auto-selection
- Ensure user authentication is complete

### Issue: Data not updating on brand change
**Solutions**:
- Verify hooks are using `selectedBrandId` from context
- Check API calls include brand parameter
- Ensure proper dependency arrays in useEffect hooks

### Issue: Dropdown not appearing
**Solutions**:
- Verify multiple brands exist
- Check sidebar component integration
- Ensure BrandContext is providing brands correctly

## 📊 Test Results Interpretation

### ✅ All Tests Passing
- BrandContext is fully functional
- Integration is working correctly
- Ready for production use

### ⚠️ Some Warnings
- Minor issues that don't break functionality
- Usually related to empty states or missing data
- Review warnings for potential improvements

### ❌ Tests Failing
- Critical issues that need immediate attention
- Check console for detailed error messages
- Review implementation against this guide

## 🚀 Performance Testing

### Memory Leaks:
1. Navigate between dashboard pages multiple times
2. Check browser memory usage doesn't continuously increase
3. Verify context cleanup on unmount

### Re-render Testing:
1. Use React DevTools Profiler
2. Change brand selection
3. Verify only necessary components re-render
4. Check for cascading re-renders

## 📝 Test Documentation

When testing is complete, document:
- [ ] Test results and any issues found
- [ ] Browser compatibility testing results
- [ ] Performance benchmarks
- [ ] Any configuration or setup notes
- [ ] Recommendations for production deployment

## 🔧 Cleanup

After testing is complete:
- [ ] Remove test page (`/dashboard/test-brand-context`)
- [ ] Remove test components (`BrandContextTester.tsx`)
- [ ] Keep test utilities for future debugging if needed
- [ ] Update documentation with any findings

---

## Quick Reference

**Test Page URL**: `/dashboard/test-brand-context`
**Console Test Command**: `testBrandContext()`
**Key localStorage Item**: `selectedBrandId`
**Main Hook**: `useBrandContext()`
**Provider Component**: `BrandContextProvider` 