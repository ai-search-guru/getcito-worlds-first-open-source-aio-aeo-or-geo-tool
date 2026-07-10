// Test script for Firebase Admin SDK configuration
// Using native fetch (Node.js 18+)

// Configuration
const BASE_URL = 'http://localhost:3001'; // Server is running on port 3001
const DEBUG_ENDPOINT = '/api/debug-providers';

async function testFirebaseAdmin() {
  console.log('🔍 Testing Firebase Admin SDK Configuration');
  console.log('===========================================');
  console.log('');

  try {
    console.log('🌐 Checking server connection...');
    
    const response = await fetch(`${BASE_URL}${DEBUG_ENDPOINT}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    console.log('📊 Response Status:', response.status);
    console.log('📊 Response Status Text:', response.statusText);
    console.log('');

    if (!response.ok) {
      throw new Error(`Server responded with status: ${response.status}`);
    }

    const data = await response.json();
    
    console.log('✅ Successfully connected to debug endpoint');
    console.log('');

    // Check environment variables
    console.log('🔑 ENVIRONMENT VARIABLES CHECK:');
    console.log('================================');
    if (data.checks && data.checks.environment) {
      const env = data.checks.environment;
      console.log('  OPENAI_API_KEY:', env.OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
      console.log('  AZURE_OPENAI_API_KEY:', env.AZURE_OPENAI_API_KEY ? '✅ Set' : '❌ Missing');
      console.log('  GOOGLE_AI_API_KEY:', env.GOOGLE_AI_API_KEY ? '✅ Set' : '❌ Missing');
      console.log('  PERPLEXITY_API_KEY:', env.PERPLEXITY_API_KEY ? '✅ Set' : '❌ Missing');
      console.log('  DATAFORSEO_USERNAME:', env.DATAFORSEO_USERNAME ? '✅ Set' : '❌ Missing');
      console.log('  DATAFORSEO_PASSWORD:', env.DATAFORSEO_PASSWORD ? '✅ Set' : '❌ Missing');
      
      // Firebase Admin specific checks
      console.log('');
      console.log('🔥 FIREBASE ADMIN SDK CHECK:');
      console.log('=============================');
      console.log('  FIREBASE_CLIENT_EMAIL:', env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
      console.log('  FIREBASE_PRIVATE_KEY:', env.FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
      console.log('  NEXT_PUBLIC_FIREBASE_PROJECT_ID:', env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
    }
    console.log('');

    // Check Firebase Admin SDK status
    console.log('🔧 FIREBASE ADMIN SDK STATUS:');
    console.log('==============================');
    if (data.checks) {
      console.log('  Firebase Admin Package:', data.checks.firebaseAdminPackage || 'Not checked');
      console.log('  Firebase Admin SDK:', data.checks.firebaseAdmin || 'Not checked');
      console.log('  Auth Middleware:', data.checks.authMiddleware || 'Not checked');
    }
    console.log('');

    // Check provider manager status
    console.log('🔧 PROVIDER MANAGER STATUS:');
    console.log('============================');
    if (data.checks && data.checks.providerManagerImport) {
      console.log('  Provider Manager Import:', data.checks.providerManagerImport);
    }
    
    if (data.checks && data.checks.availableProviders) {
      console.log('  Available Providers:', data.checks.availableProviders);
      
      // Check if our target providers are available
      const targetProviders = ['chatgptsearch', 'google-ai-overview', 'perplexity'];
      targetProviders.forEach(provider => {
        const available = data.checks.availableProviders.includes(provider);
        console.log(`    ${provider}:`, available ? '✅ Available' : '❌ Not Available');
      });
    }
    console.log('');

    // Check for any recommendations
    if (data.recommendations && data.recommendations.length > 0) {
      console.log('⚠️  RECOMMENDATIONS:');
      console.log('====================');
      data.recommendations.forEach(rec => {
        console.log('  ' + rec);
      });
      console.log('');
    }

    // Overall status
    const hasFirebaseAdmin = data.checks?.environment?.FIREBASE_CLIENT_EMAIL && 
                           data.checks?.environment?.FIREBASE_PRIVATE_KEY &&
                           data.checks?.environment?.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    
    const firebaseAdminWorking = data.checks?.firebaseAdmin?.includes('✅');
    const authMiddlewareWorking = data.checks?.authMiddleware?.includes('✅');
    
    console.log('📋 OVERALL STATUS:');
    console.log('==================');
    console.log('  Server Status:', '✅ Running on port 3001');
    console.log('  Debug Endpoint:', '✅ Accessible');
    console.log('  Firebase Admin Environment:', hasFirebaseAdmin ? '✅ Configured' : '❌ Missing Credentials');
    console.log('  Firebase Admin SDK:', firebaseAdminWorking ? '✅ Working' : '❌ Issues');
    console.log('  Auth Middleware:', authMiddlewareWorking ? '✅ Available' : '❌ Issues');
    console.log('  Provider Manager:', data.checks?.providerManagerImport?.includes('Success') ? '✅ Working' : '❌ Issues');
    
    if (hasFirebaseAdmin && firebaseAdminWorking && authMiddlewareWorking) {
      console.log('');
      console.log('🎉 Firebase Admin SDK is properly configured and working!');
      console.log('');
      console.log('🧪 NEXT STEPS:');
      console.log('==============');
      console.log('1. Test authentication with a real Firebase ID token');
      console.log('2. Get your Firebase ID token from browser localStorage');
      console.log('3. Update the FIREBASE_ID_TOKEN in test-user-query-with-auth.js');
      console.log('4. Run: node test-user-query-with-auth.js');
      console.log('');
      console.log('📋 How to get Firebase ID token:');
      console.log('1. Open http://localhost:3001 and sign in');
      console.log('2. Press F12 to open Developer Tools');
      console.log('3. Go to Application/Storage tab');
      console.log('4. Find "firebase:authUser" in localStorage');
      console.log('5. Copy the "stsTokenManager.accessToken" value');
    } else {
      console.log('');
      console.log('❌ Firebase Admin SDK configuration issues detected');
      console.log('');
      console.log('🔧 TROUBLESHOOTING:');
      console.log('===================');
      if (!hasFirebaseAdmin) {
        console.log('1. Check your .env.local file');
        console.log('2. Ensure FIREBASE_CLIENT_EMAIL is set');
        console.log('3. Ensure FIREBASE_PRIVATE_KEY is properly escaped with \\n');
        console.log('4. Ensure NEXT_PUBLIC_FIREBASE_PROJECT_ID is set');
      }
      if (!firebaseAdminWorking) {
        console.log('5. Check server logs for Firebase Admin SDK initialization errors');
        console.log('6. Verify your service account credentials are correct');
      }
      if (!authMiddlewareWorking) {
        console.log('7. Check authentication middleware implementation');
      }
      console.log('8. Restart the development server after making changes');
    }

  } catch (error) {
    console.log('❌ Test failed with error:', error.message);
    console.log('');
    console.log('🔧 TROUBLESHOOTING:');
    console.log('===================');
    console.log('1. Make sure the Next.js server is running (npm run dev)');
    console.log('2. Check that the server is running on port 3001');
    console.log('3. Verify your Firebase Admin credentials in .env.local');
    console.log('4. Check the server logs for more details');
    console.log('');
    console.log('💡 TIP: The server logs should show:');
    console.log('   "✅ Firebase Admin SDK initialized successfully"');
  }
}

// Run the test
testFirebaseAdmin(); 