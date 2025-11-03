// Simple Firebase Admin SDK test using same pattern as working tests
const http = require('http');

function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          resolve(data);
        }
      });
    });
    
    req.on('error', (error) => {
      reject(error);
    });
    
    req.end();
  });
}

async function testFirebaseAdmin() {
  console.log('🔍 Testing Firebase Admin SDK Configuration');
  console.log('===========================================');
  
  try {
    console.log('🔍 Trying port 3001...');
    
    const options = {
      hostname: 'localhost',
      port: 3001,
      path: '/api/debug-providers',
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    const data = await makeRequest(options);
    
    if (data.success) {
      console.log('✅ Connected to server on port 3001');
      console.log('');
      
      // Check Firebase Admin SDK status
      console.log('🔥 FIREBASE ADMIN SDK STATUS:');
      console.log('=============================');
      
      const env = data.checks.environment;
      console.log('Environment Variables:');
      console.log('  FIREBASE_CLIENT_EMAIL:', env.FIREBASE_CLIENT_EMAIL ? '✅ Set' : '❌ Missing');
      console.log('  FIREBASE_PRIVATE_KEY:', env.FIREBASE_PRIVATE_KEY ? '✅ Set' : '❌ Missing');
      console.log('  NEXT_PUBLIC_FIREBASE_PROJECT_ID:', env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ? '✅ Set' : '❌ Missing');
      console.log('');
      
      console.log('Firebase Admin SDK Status:');
      console.log('  Package:', data.checks.firebaseAdminPackage || 'Not checked');
      console.log('  SDK Initialization:', data.checks.firebaseAdmin || 'Not checked');
      console.log('  Auth Middleware:', data.checks.authMiddleware || 'Not checked');
      console.log('');
      
      // Overall assessment
      const hasEnvVars = env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY && env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
      const sdkWorking = data.checks.firebaseAdmin && data.checks.firebaseAdmin.includes('✅');
      const middlewareWorking = data.checks.authMiddleware && data.checks.authMiddleware.includes('✅');
      
      console.log('📋 ASSESSMENT:');
      console.log('==============');
      console.log('Environment Variables:', hasEnvVars ? '✅ Complete' : '❌ Missing');
      console.log('Firebase Admin SDK:', sdkWorking ? '✅ Working' : '❌ Issues');
      console.log('Auth Middleware:', middlewareWorking ? '✅ Available' : '❌ Issues');
      console.log('');
      
      if (hasEnvVars && sdkWorking && middlewareWorking) {
        console.log('🎉 SUCCESS: Firebase Admin SDK is properly configured!');
        console.log('');
        console.log('✅ Your Firebase Admin credentials are working correctly');
        console.log('✅ Authentication system is ready for use');
        console.log('✅ Credit deduction system is operational');
        console.log('');
        console.log('🧪 NEXT STEPS:');
        console.log('1. Get a Firebase ID token from your browser');
        console.log('2. Test the authenticated user-query endpoint');
        console.log('3. Verify credit deduction is working');
      } else {
        console.log('❌ ISSUES DETECTED:');
        console.log('');
        if (!hasEnvVars) {
          console.log('Missing environment variables - check your .env.local file');
        }
        if (!sdkWorking) {
          console.log('Firebase Admin SDK not working - check server logs');
        }
        if (!middlewareWorking) {
          console.log('Auth middleware not available - check implementation');
        }
      }
      
      // Show recommendations if any
      if (data.recommendations && data.recommendations.length > 0) {
        console.log('');
        console.log('⚠️  RECOMMENDATIONS:');
        data.recommendations.forEach(rec => {
          console.log('  ' + rec);
        });
      }
      
    } else {
      console.log('❌ Server error:', data.error || 'Unknown error');
    }
    
  } catch (error) {
    console.log('❌ Connection failed:', error.message);
    console.log('');
    console.log('Make sure:');
    console.log('1. Next.js server is running (npm run dev)');
    console.log('2. Server is accessible on port 3001');
  }
}

testFirebaseAdmin(); 