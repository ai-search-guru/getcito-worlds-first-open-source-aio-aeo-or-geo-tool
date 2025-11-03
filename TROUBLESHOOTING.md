# Troubleshooting Guide

## 🚨 Common Issues & Solutions

### API 500 Errors - Query Processing Failed

**Error**: `Failed to process query (500): how to shop on Amazon.in...`

**Symptoms**:
- Query processing fails with 500 status
- Error occurs in ProcessQueriesButton component
- API providers fail to execute

**Root Causes & Solutions**:

#### 1. Missing Environment Variables
Check that all required API provider credentials are set:

```bash
# Check environment variables
echo "OPENAI_API_KEY: $OPENAI_API_KEY"
echo "PERPLEXITY_API_KEY: $PERPLEXITY_API_KEY"
echo "DATAFORSEO_USERNAME: $DATAFORSEO_USERNAME"
echo "DATAFORSEO_PASSWORD: $DATAFORSEO_PASSWORD"
echo "FIREBASE_CLIENT_EMAIL: $FIREBASE_CLIENT_EMAIL"
echo "FIREBASE_PRIVATE_KEY: [REDACTED]"
```

**Required Environment Variables:**
```env
# OpenAI (for ChatGPT Search)
OPENAI_API_KEY=sk-your_openai_api_key

# Perplexity AI
PERPLEXITY_API_KEY=pplx-your_perplexity_api_key

# DataForSEO (for Google AI Overview)
DATAFORSEO_USERNAME=your_dataforseo_username
DATAFORSEO_PASSWORD=your_dataforseo_password

# Firebase Admin SDK (for authentication)
FIREBASE_CLIENT_EMAIL=your_service_account@project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nYOUR_PRIVATE_KEY\n-----END PRIVATE KEY-----\n"
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
```

#### 2. Provider Configuration Issues
Test individual providers to identify which one is failing:

```bash
# Test debug endpoint
curl http://localhost:3001/api/debug-providers

# Test individual providers
curl -X POST http://localhost:3001/api/test-perplexity \
  -H "Content-Type: application/json" \
  -d '{"prompt": "test query"}'
```

#### 3. API Key Validation
Ensure your API keys are valid and have sufficient credits:

**OpenAI API Key:**
- Must start with `sk-`
- Check usage limits at https://platform.openai.com/usage
- Ensure billing is set up

**Perplexity API Key:**
- Must start with `pplx-`
- Check credits at https://www.perplexity.ai/settings/api
- Verify API access is enabled

**DataForSEO Credentials:**
- Check credits at https://dataforseo.com/apis/credits
- Verify username/password combination
- Ensure SERP API access is enabled

#### 4. Firebase Admin SDK Issues
Common Firebase authentication problems:

```bash
# Test Firebase Admin SDK
node -e "
const admin = require('firebase-admin');
try {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\\\n/g, '\\n')
    })
  });
  console.log('✅ Firebase Admin SDK initialized successfully');
} catch (error) {
  console.error('❌ Firebase Admin SDK error:', error.message);
}
"
```

#### 5. Network and Timeout Issues
Provider requests may timeout due to network issues:

```env
# Increase timeouts (add to .env.local)
PROVIDER_TIMEOUT=60000
PROVIDER_RETRY_ATTEMPTS=5
```

#### 6. Quick Fix Script
Create a script to validate your configuration:

```bash
# Create validate-config.js
cat > validate-config.js << 'EOF'
const requiredEnvVars = [
  'OPENAI_API_KEY',
  'PERPLEXITY_API_KEY', 
  'DATAFORSEO_USERNAME',
  'DATAFORSEO_PASSWORD',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'NEXT_PUBLIC_FIREBASE_PROJECT_ID'
];

console.log('🔍 Validating Environment Configuration...\n');

let allValid = true;
requiredEnvVars.forEach(varName => {
  const value = process.env[varName];
  const isSet = !!value && value.trim() !== '';
  console.log(`${isSet ? '✅' : '❌'} ${varName}: ${isSet ? 'SET' : 'MISSING'}`);
  if (!isSet) allValid = false;
});

console.log(`\n${allValid ? '✅ All required environment variables are set!' : '❌ Some environment variables are missing!'}`);

if (!allValid) {
  console.log('\n📝 Create a .env.local file with the missing variables.');
  console.log('📖 See ENV_VARIABLES_SETUP.md for detailed setup instructions.');
}
EOF

# Run validation
node validate-config.js
```

#### 7. Provider Manager Debug
Add debug logging to identify the failing provider:

```javascript
// Add to your .env.local for detailed logging
DEBUG=api-providers:*
NODE_ENV=development
```

**Immediate Actions:**
1. ✅ Check `.env.local` file exists and contains all required variables
2. ✅ Restart development server after adding environment variables
3. ✅ Test `/api/debug-providers` endpoint to verify provider configuration
4. ✅ Check browser console for detailed error messages
5. ✅ Verify API key validity and credits/quota availability

### ChunkLoadError

**Error**: `ChunkLoadError` during development or production

**Symptoms**:
- Webpack chunk loading failures
- `__webpack_require__.f.j` errors
- Page fails to load completely

**Solutions**:

1. **Clear Build Cache** (Most Common Fix)
   ```bash
   rm -rf .next
   rm -rf node_modules/.cache
   npm run dev
   ```

2. **Check for Port Conflicts**
   ```bash
   # Kill all Node.js processes
   taskkill /f /im node.exe    # Windows
   killall node               # macOS/Linux
   
   # Start fresh
   npm run dev
   ```

3. **Update Dependencies**
   ```bash
   npm update
   npm audit fix
   ```

4. **Check Dynamic Imports**
   - Ensure all dynamic imports are properly structured
   - Verify component exports are correct

### EPERM Errors (Windows)

**Error**: `EPERM: operation not permitted, open '.next\trace'`

**Solutions**:

1. **Run as Administrator**
   - Right-click terminal/command prompt
   - Select "Run as administrator"

2. **Disable Antivirus Scanning**
   - Temporarily disable real-time scanning
   - Add project folder to antivirus exclusions

3. **Clear File Locks**
   ```bash
   # Stop all Node processes
   taskkill /f /im node.exe
   
   # Delete .next directory
   rmdir /s /q .next
   
   # Restart development server
   npm run dev
   ```

### Authentication Issues

**Error**: Infinite redirects or authentication loops

**Solutions**:

1. **Check Firebase Configuration**
   ```bash
   # Verify environment variables
   echo $NEXT_PUBLIC_FIREBASE_API_KEY
   ```

2. **Clear Browser Storage**
   - Clear localStorage and sessionStorage
   - Clear cookies for localhost
   - Try incognito/private mode

3. **Check AuthContext**
   - Verify AuthContext is properly wrapped
   - Check for multiple AuthContext providers

### Component Import Errors

**Error**: Module not found or import errors

**Solutions**:

1. **Check File Paths**
   - Verify relative imports are correct
   - Check for typos in file names

2. **Clear Module Cache**
   ```bash
   rm -rf node_modules/.cache
   npm run dev
   ```

3. **Check TypeScript Configuration**
   ```bash
   npx tsc --noEmit
   ```

### Firebase Connection Issues

**Error**: Firebase initialization or connection problems

**Solutions**:

1. **Verify Firebase Config**
   ```javascript
   // Check firebase config in browser console
   console.log(process.env.NEXT_PUBLIC_FIREBASE_API_KEY);
   ```

2. **Check Network Rules**
   - Verify firewall settings
   - Check if Firebase domains are accessible

3. **Update Firebase SDK**
   ```bash
   npm update firebase firebase-admin
   ```

## 🔧 Debug Tools

### Environment Variable Checker
```bash
# Create a debug script
echo 'console.log("Environment check:", {
  NODE_ENV: process.env.NODE_ENV,
  FIREBASE_PROJECT: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  HAS_OPENAI_KEY: !!process.env.OPENAI_API_KEY,
  HAS_PERPLEXITY_KEY: !!process.env.PERPLEXITY_API_KEY
});' > check-env.js

node check-env.js
```

### API Endpoint Testing
```bash
# Test API endpoints
curl http://localhost:3000/api/debug-providers
curl -X POST http://localhost:3000/api/test-auth \
  -H "Content-Type: application/json" \
  -d '{"test": true}'
```

### Browser Console Commands
```javascript
// Check authentication state
console.log('Auth state:', window.firebase?.auth()?.currentUser);

// Check environment variables
console.log('Environment:', {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY?.substring(0, 10) + '...',
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID
});
```

## 📞 Getting Help

If issues persist after trying these solutions:

1. **Check Server Logs**: Look for detailed error messages in the terminal
2. **Browser DevTools**: Check Network and Console tabs for errors
3. **Firebase Console**: Verify project configuration and authentication
4. **API Provider Dashboards**: Check usage limits and API key status

### Creating Support Requests

When reporting issues, include:
- Error message (full stack trace)
- Steps to reproduce
- Environment details (OS, Node.js version, browser)
- Configuration status (which environment variables are set)
- Recent changes made to the codebase 