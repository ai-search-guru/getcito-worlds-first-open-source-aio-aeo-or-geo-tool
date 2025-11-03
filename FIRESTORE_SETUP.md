# Firestore Security Rules Setup

## 🚨 Issue: Permission Denied Errors

You're seeing `permission-denied` errors because Firestore security rules are blocking access to the database. Here's how to fix it:

## 🔧 Quick Fix (Development)

### Option 1: Use Firebase Console (Recommended)

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Navigate to **Firestore Database** → **Rules**
4. Replace the existing rules with the **development rules** below:

```javascript
rules_version = '2';

service cloud.firestore {
  match /databases/{database}/documents {
    // DEVELOPMENT RULES - More permissive for testing
    // DO NOT USE IN PRODUCTION
    
    // Allow authenticated users to read/write all data
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

5. Click **Publish**

### Option 2: Use Firebase CLI

1. Install Firebase CLI if you haven't:
   ```bash
   npm install -g firebase-tools
   ```

2. Login to Firebase:
   ```bash
   firebase login
   ```

3. Initialize Firebase in your project (if not done):
   ```bash
   firebase init firestore
   ```

4. Deploy the development rules:
   ```bash
   firebase deploy --only firestore:rules
   ```

## 📁 Files Created

- `firestore.rules` - Production-ready security rules
- `firestore.dev.rules` - Development rules (more permissive)
- `firestore.indexes.json` - Database indexes (if needed)

## 🏗️ Database Collections Structure

After setting up the rules, you can use the **"Seed Sample Data"** button in the dashboard to populate your database with test data. The following collections will be created:

- `user_metrics/{userId}` - User KPI metrics
- `user_recommendations/{docId}` - Personalized recommendations  
- `user_top_domains/{docId}` - User's top performing domains
- `user_trends/{docId}` - Historical trend data
- `user_brand_prompts/{docId}` - Brand prompt analysis
- `brand_leaderboard/{docId}` - Global brand leaderboard

## 🔒 Production Security Rules

For production, use the rules in `firestore.rules` which implement proper security:

- Users can only access their own data
- Global leaderboard is read-only
- All operations require authentication

## 🔄 Next Steps

1. Apply the development rules using Firebase Console
2. Refresh your dashboard page
3. Click "Seed Sample Data" to populate the database
4. Your dashboard should now load with real data!

## 🐛 Troubleshooting

If you still see permission errors:

1. **Check Authentication**: Make sure you're signed in
2. **Verify Rules**: Ensure rules are published in Firebase Console
3. **Clear Cache**: Refresh the browser page
4. **Check Console**: Look for detailed error messages in browser console

## 📞 Need Help?

If you continue having issues, check:
- Firebase Console → Authentication → Users (ensure user exists)
- Firebase Console → Firestore → Rules (verify rules are active)
- Browser Network tab (check for 401/403 errors) 