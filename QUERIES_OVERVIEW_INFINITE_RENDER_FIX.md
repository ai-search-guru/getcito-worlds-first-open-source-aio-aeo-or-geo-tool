# QueriesOverview Infinite Re-render Fix

## Problem
The QueriesOverview component was experiencing "Maximum update depth exceeded" errors due to infinite re-renders caused by the countdown useEffect.

## Root Cause Analysis

### Initial Issue
The useEffect for countdown logic had `queryResults` in its dependency array:
```tsx
useEffect(() => {
  // countdown logic with setCountdown calls
}, [brand, queryResults]); // ❌ queryResults changes on every render
```

### Why It Caused Infinite Loop
1. **Memoized dependency**: `queryResults` was created with `useMemo([...savedResults, ...liveResults])`
2. **Array recreation**: Even though `useMemo` was used, the dependency on `savedResults` and `liveResults` meant the array could be recreated
3. **setInterval side effects**: Every second, `setCountdown` was called
4. **Re-render trigger**: Each `setCountdown` call triggered a re-render
5. **Dependency recalculation**: Re-render caused `queryResults` to be recalculated
6. **Effect re-execution**: Changed `queryResults` triggered the useEffect again
7. **Infinite cycle**: This created an endless loop of re-renders

## Solution Implemented

### Step 1: Stable Value Creation
```tsx
// Create stable values for the countdown effect
const resultsCount = useMemo(() => queryResults.length, [queryResults.length]);
const latestResultTime = useMemo(() => {
  if (queryResults.length === 0) return 0;
  return Math.max(...queryResults.map(r => r.date ? new Date(r.date).getTime() : 0));
}, [queryResults]);
```

### Step 2: Optimized useEffect Dependencies
```tsx
useEffect(() => {
  // countdown logic...
}, [brand?.id, resultsCount, latestResultTime]); // ✅ Stable primitives only
```

### Step 3: Conditional State Updates
```tsx
setCountdown(prev => {
  // Only update if values actually changed to prevent unnecessary re-renders
  if (prev.days !== days || prev.hours !== hours || prev.minutes !== minutes || prev.seconds !== seconds) {
    return { days, hours, minutes, seconds };
  }
  return prev; // ✅ Return same object if no change
});
```

## Key Improvements

### 1. Stable Dependencies
- **Before**: Used `queryResults` array directly (unstable reference)
- **After**: Used `resultsCount` and `latestResultTime` (stable primitives)

### 2. Conditional Updates
- **Before**: `setCountdown` called every second regardless of changes
- **After**: `setCountdown` only called when values actually change

### 3. Reduced Array Operations
- **Before**: Array sorting and manipulation in useEffect
- **After**: Simple loop to find latest date

### 4. Better Performance
- **Before**: Expensive array operations on every interval tick
- **After**: Minimal computation with early returns

## Technical Details

### Dependency Comparison
```tsx
// ❌ Before: Unstable dependencies
}, [brand, queryResults]);

// ✅ After: Stable primitive dependencies  
}, [brand?.id, resultsCount, latestResultTime]);
```

### State Update Pattern
```tsx
// ❌ Before: Always creates new object
setCountdown({ days, hours, minutes, seconds });

// ✅ After: Conditional object creation
setCountdown(prev => {
  if (valuesChanged) return { days, hours, minutes, seconds };
  return prev;
});
```

## Result
- ✅ **No more infinite re-renders**: Component renders only when necessary
- ✅ **Preserved functionality**: Countdown still updates every second when values change
- ✅ **Better performance**: Reduced unnecessary computations and re-renders
- ✅ **Stable behavior**: No "Maximum update depth exceeded" errors

## Prevention Strategy
1. **Use primitive dependencies**: Avoid objects/arrays in useEffect dependencies
2. **Memoize computed values**: Use `useMemo` for stable derived values
3. **Conditional state updates**: Only update state when values actually change
4. **Test with React Strict Mode**: Double-rendering helps catch these issues early

This fix ensures the QueriesOverview component renders efficiently without infinite loops while maintaining all countdown functionality. 