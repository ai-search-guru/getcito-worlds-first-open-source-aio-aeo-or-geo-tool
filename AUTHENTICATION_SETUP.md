# Authentication & Route Protection Setup

## 🔒 Overview

The V8 Dashboard now includes comprehensive authentication and route protection to ensure only authenticated users can access dashboard functionality.

## ✅ What's Protected

### Dashboard Routes
All routes under `/dashboard/*` are now protected:
- `/dashboard` - Main dashboard
- `/dashboard/queries` - Queries management
- `/dashboard/analytics` - Analytics dashboard
- `/dashboard/competitors` - Competitor analysis
- `/dashboard/admin` - Admin panel (requires admin role)
- `/dashboard/add-brand/*` - Brand management
- All other dashboard sub-routes

### API Routes
Optional protection for API endpoints with token verification utilities.

## 🛡️ Protection Layers

### 1. Layout-Level Protection
**File**: `src/app/dashboard/layout.tsx`
- Wraps all dashboard routes
- Checks authentication state using `AuthContext`
- Redirects unauthenticated users to `/signin`
- Shows loading states during auth checks

### 2. Component-Level Protection  
**File**: `src/components/auth/ProtectedRoute.tsx`
- Reusable component for granular protection
- Supports admin role verification
- Customizable redirect paths
- Custom loading components

### 3. Middleware Protection
**File**: `src/middleware.ts`
- Server-side route protection
- Optional API endpoint protection
- Currently configured for future enhancements

## 🔧 Implementation Details

### Authentication Context
```tsx
// Check if user is authenticated
const { user, loading } = useAuthContext();

if (loading) {
  return <LoadingComponent />;
}

if (!user) {
  // User will be redirected to sign-in
  return null;
}
```

### Protected Route Usage
```tsx
// Basic protection
<ProtectedRoute>
  <YourComponent />
</ProtectedRoute>

// Admin protection
<ProtectedRoute 
  requireAdmin={true} 
  adminEmails={['admin@example.com']}
>
  <AdminPanel />
</ProtectedRoute>

// Custom redirect and loading
<ProtectedRoute 
  redirectTo="/custom-login"
  loadingComponent={<CustomLoader />}
>
  <ProtectedContent />
</ProtectedRoute>
```

### Admin Configuration
**File**: `src/app/dashboard/admin/page.tsx`
```tsx
const ADMIN_EMAILS = [
  'admin@example.com',
  'developer@example.com',
  'team@getaimonitor.com',
  'write2avinash007@gmail.com'
];
```

## 🧪 Testing Authentication

### Test Scenarios

1. **Unauthenticated Access**
   - Visit `/dashboard/queries` without logging in
   - Should redirect to `/signin`

2. **Authenticated Access**
   - Sign in with valid credentials
   - Should access dashboard routes normally

3. **Admin Access**
   - Sign in with admin email
   - Should access admin panel
   - Non-admin users get "Access Denied"

### Manual Testing

```bash
# Test unauthenticated access (should redirect)
curl -I http://localhost:3002/dashboard/queries

# Test with browser (recommended)
# 1. Open browser in incognito mode
# 2. Navigate to http://localhost:3002/dashboard/queries
# 3. Should redirect to sign-in page
```

## 🔐 Security Features

### Client-Side Protection
- ✅ Automatic redirection for unauthenticated users
- ✅ Loading states during authentication checks
- ✅ Admin role verification with email whitelist
- ✅ Proper error handling and user feedback

### Server-Side Protection
- ✅ Middleware for API route protection
- ✅ Token verification utilities
- ✅ Firestore security rules
- ✅ Environment-based configuration

### Firebase Security
- ✅ Firebase Auth integration
- ✅ Secure token management
- ✅ Google OAuth support
- ✅ Email/password authentication

## 📁 File Structure

```
src/
├── app/
│   ├── dashboard/
│   │   ├── layout.tsx          # 🔒 Dashboard route protection
│   │   ├── page.tsx            # Protected dashboard
│   │   ├── queries/            # Protected queries
│   │   ├── admin/              # Admin-only routes
│   │   └── ...                 # All protected
│   ├── signin/
│   │   └── page.tsx            # Public sign-in
│   └── signup/
│       └── page.tsx            # Public sign-up
├── components/
│   └── auth/
│       ├── ProtectedRoute.tsx  # 🛡️ Reusable protection
│       └── AuthStatus.tsx      # Auth status display
├── context/
│   └── AuthContext.tsx         # 🔑 Auth state management
├── lib/
│   └── auth/
│       └── verifyToken.ts      # 🔍 Token verification
├── firebase/
│   └── auth/                   # 🔥 Firebase auth functions
└── middleware.ts               # 🚦 Route middleware
```

## ⚡ Quick Setup

1. **Install dependencies** (already done)
2. **Configure Firebase** (already done)
3. **Set up Firestore rules** (see `FIRESTORE_SETUP.md`)
4. **Test authentication**:
   ```bash
   npm run dev
   # Navigate to http://localhost:3002/dashboard/queries
   # Should redirect to sign-in
   ```

## 🛠️ Customization

### Add More Admin Emails
Edit `src/app/dashboard/admin/page.tsx`:
```tsx
const ADMIN_EMAILS = [
  'admin@example.com',
  'your-email@domain.com',  // Add your email
  // ... more admin emails
];
```

### Protect Additional Routes
Use the `ProtectedRoute` component:
```tsx
import ProtectedRoute from '@/components/auth/ProtectedRoute';

export default function MyProtectedPage() {
  return (
    <ProtectedRoute>
      <MyPageContent />
    </ProtectedRoute>
  );
}
```

### Custom Loading Components
```tsx
<ProtectedRoute 
  loadingComponent={
    <div className="custom-loader">
      Loading your content...
    </div>
  }
>
  <YourComponent />
</ProtectedRoute>
```

## 🐛 Troubleshooting

### Common Issues

**Issue**: "Loading..." shows indefinitely
- **Solution**: Check Firebase configuration and internet connection

**Issue**: Redirects not working
- **Solution**: Verify `useRouter` and Next.js app router setup

**Issue**: Admin access denied
- **Solution**: Check email is in `ADMIN_EMAILS` array

**Issue**: Authentication state not updating
- **Solution**: Check `AuthContext` is properly wrapped around app

### Debug Tips

```tsx
// Add debug logging
const { user, loading } = useAuthContext();
console.log('Auth Debug:', { 
  user: user?.email, 
  loading, 
  authenticated: !!user 
});
```

## 🚀 Production Considerations

### Security Checklist
- [ ] Use Firebase Admin SDK for server-side token verification
- [ ] Enable Firebase App Check for additional security
- [ ] Set up proper Firestore security rules
- [ ] Use environment variables for sensitive configuration
- [ ] Enable Firebase Auth email verification
- [ ] Set up proper CORS policies

### Performance
- [ ] Implement proper loading states
- [ ] Cache authentication state appropriately
- [ ] Optimize re-renders with `useMemo`/`useCallback`
- [ ] Use code splitting for auth components

## 📞 Support

If you encounter issues:
1. Check the browser console for errors
2. Verify Firebase configuration
3. Test with different browsers/incognito mode
4. Check this documentation for troubleshooting tips

---

🎉 **Success!** Your dashboard routes are now properly protected and only accessible to authenticated users. 