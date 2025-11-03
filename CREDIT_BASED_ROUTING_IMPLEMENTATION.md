# Credit-Based Routing Implementation

## 🎯 Feature Overview

Implemented automatic redirect for new users with 500 credits to the brand onboarding flow, including direct signup redirects for optimal user experience.

## ✅ Requirements Met

- **Available credits for users = 500**: ✅ Checks if user has exactly 500 credits
- **Redirect to add-brand/step-1**: ✅ Redirects to `/dashboard/add-brand/step-1`
- **Only change existing pages if necessary**: ✅ Only modified dashboard layout and signup page
- **Signup flow optimization**: ✅ Direct redirect from signup to add-brand flow

## 🔧 Implementation Details

### Modified Files

#### 1. `src/app/dashboard/layout.tsx` - Dashboard Layout Redirect
Added credit-based redirect logic for existing users accessing dashboard:

```tsx
// Credit-based redirect for users with 500 credits (new users)
useEffect(() => {
  // Only check credits if user is authenticated and user profile is loaded
  if (user && userProfile && !loading) {
    // Check if user has exactly 500 credits (indicating a new user)
    const hasDefaultCredits = userProfile.credits === 500;
    
    // Only redirect if they have 500 credits AND they're not already on the add-brand flow
    if (hasDefaultCredits && !pathname.startsWith('/dashboard/add-brand')) {
      console.log('🎯 Redirecting new user with 500 credits to add-brand flow');
      router.push('/dashboard/add-brand/step-1');
      return;
    }
  }
}, [user, userProfile, loading, pathname, router]);
```

#### 2. `src/app/signup/page.tsx` - Direct Signup Redirect
Updated both email/password and Google signup to redirect directly to brand setup:

```tsx
// Email/Password Signup
router.push("/dashboard/add-brand/step-1");

// Google Sign-In Signup  
router.push("/dashboard/add-brand/step-1");
```

### Key Features

1. **Smart Detection**: Only users with exactly 500 credits are redirected (new users)
2. **Path Awareness**: Checks current path to avoid redirect loops
3. **Seamless Integration**: Works with existing authentication and routing
4. **Self-Resolving**: Once users spend/change credits, they won't be redirected anymore
5. **Direct Signup Flow**: New signups go straight to brand setup without dashboard detour

## 🔄 User Flow

### New User Journey (Optimized)
1. **Sign Up** → **Direct redirect** to `/dashboard/add-brand/step-1` ⚡
2. **Complete Onboarding** → Credits change during process
3. **Future Access** → Normal dashboard access

### New User Journey (Fallback via Dashboard)
1. **Direct Dashboard Access** → Layout detects 500 credits
2. **Automatic Redirect** → Sent to `/dashboard/add-brand/step-1`
3. **Complete Onboarding** → Credits change during process
4. **Future Access** → No more redirects, normal dashboard access

### Existing User Journey
1. **Sign In** → Redirected to `/dashboard`
2. **Dashboard Layout Loads** → Credits ≠ 500 (existing user)
3. **Normal Access** → Dashboard loads normally

## 🛡️ Safety Features

### Prevents Redirect Loops
- **Path Check**: `!pathname.startsWith('/dashboard/add-brand')`
- **Credit Check**: Only exact 500 credits trigger redirect
- **Loading Check**: Only executes when user profile is fully loaded

### Preserves Existing Functionality
- **Authentication**: All existing auth protection remains intact
- **Admin Routes**: Admin routing unaffected
- **API Routes**: No changes to API routing
- **Signin Page**: Signin page unchanged (still goes to dashboard)

## 🧪 Test Scenarios

### Scenario 1: New User Registration (Optimized)
```
1. User signs up → Gets 500 credits
2. Direct redirect to /dashboard/add-brand/step-1 ⚡
3. No dashboard detour needed ✅
```

### Scenario 2: New User with Google Sign-In (Optimized)
```
1. User signs up with Google → Gets 500 credits
2. Direct redirect to /dashboard/add-brand/step-1 ⚡
3. No dashboard detour needed ✅
```

### Scenario 3: New User Accessing Dashboard Directly
```
1. New user navigates to /dashboard directly
2. Layout detects 500 credits → Auto-redirected to add-brand ✅
```

### Scenario 4: Existing User
```
1. User signs in → Has credits ≠ 500
2. Redirected to /dashboard → Layout ignores credit check
3. Dashboard loads normally ✅
```

### Scenario 5: User Already in Add-Brand Flow
```
1. New user navigates directly to /dashboard/add-brand/step-2
2. Layout detects 500 credits but path starts with /dashboard/add-brand
3. No redirect, stays on current page ✅
```

### Scenario 6: User Completes Onboarding
```
1. User processes queries → Credits deducted
2. Returns to /dashboard → Credits now < 500
3. Dashboard loads normally, no redirect ✅
```

## 💰 Credit System Integration

### New User Creation
- **Initial Credits**: 500 (defined in `src/firebase/firestore/userProfile.ts`)
- **Profile Flag**: `isNewUser: true` when created
- **Credit Display**: Shown in sidebar with real-time updates

### Credit Usage
- **AI Queries**: Deduct credits per query processed
- **Brand Analysis**: Credits used for company info generation
- **Data Processing**: Credits consumed during brand data generation

### Credit Management
- **Deduction**: `useUserCredits().deduct(amount)`
- **Addition**: `useUserCredits().add(amount)` 
- **Update**: `useUserCredits().updateCredits(amount)`
- **Check**: `useUserCredits().hasCredits(amount)`

## 🔍 Debugging

### Console Logs
- **Redirect Trigger**: `🎯 Redirecting new user with 500 credits to add-brand flow`
- **Profile Creation**: `🎉 New user profile created with 500 credits`
- **Profile Loading**: `👤 User profile loaded with X credits`

### Development Tools
```javascript
// Check user credit status in browser console
console.log('User Credits:', window?.auth?.currentUser?.credits);

// Check if redirect logic should trigger
const userProfile = /* get from auth context */;
const pathname = window.location.pathname;
const shouldRedirect = userProfile?.credits === 500 && !pathname.startsWith('/dashboard/add-brand');
console.log('Should redirect:', shouldRedirect);
```

## 📊 Benefits

1. **Improved Onboarding**: New users are immediately guided to set up their first brand
2. **Better User Experience**: No confusion about where to start
3. **Higher Engagement**: Users are more likely to complete the setup process
4. **Seamless Integration**: Works with all existing features without conflicts
5. **Self-Managing**: No manual intervention needed once implemented
6. **Optimized Flow**: Direct signup redirect eliminates unnecessary dashboard stop ⚡
7. **Reduced Friction**: Faster path to value for new users

## 🔧 Configuration

### Customizing Credit Threshold
To change the credit amount that triggers redirect:

```tsx
// In src/app/dashboard/layout.tsx
const hasDefaultCredits = userProfile.credits === 500; // Change this value
```

### Customizing Redirect Destination
To change where new users are redirected:

```tsx
// In src/app/dashboard/layout.tsx and src/app/signup/page.tsx
router.push('/dashboard/add-brand/step-1'); // Change this path
```

### Adding Conditions
To add additional conditions for redirect:

```tsx
const hasDefaultCredits = userProfile.credits === 500;
const isNewUser = userProfile.isNewUser; // Additional condition
const hasNoBrands = brands.length === 0; // Another condition

if (hasDefaultCredits && isNewUser && hasNoBrands && !pathname.startsWith('/dashboard/add-brand')) {
  // Redirect logic
}
```

## 🚀 Future Enhancements

Potential improvements that could be added:

1. **Welcome Message**: Show a welcome modal before redirecting
2. **Progress Tracking**: Track onboarding completion rates
3. **A/B Testing**: Test different redirect thresholds
4. **Skip Option**: Allow users to skip onboarding temporarily
5. **Analytics**: Track user behavior after redirect

## ✅ Conclusion

The credit-based routing feature has been successfully implemented with:
- ✅ Minimal code changes (only 2 files modified)
- ✅ No breaking changes to existing functionality  
- ✅ Smart redirect logic with loop prevention
- ✅ Integration with existing credit system
- ✅ Clear debugging and monitoring capabilities
- ✅ Optimized signup flow for better user experience
- ✅ Dual-layer protection (signup + dashboard layout)

**Two-Layer Redirect System:**
1. **Primary**: Direct signup redirect (fastest, most efficient)
2. **Fallback**: Dashboard layout redirect (catches edge cases)

New users with 500 credits will now be automatically guided to the brand setup flow through the most efficient path possible, improving the overall user experience and onboarding success rate. 