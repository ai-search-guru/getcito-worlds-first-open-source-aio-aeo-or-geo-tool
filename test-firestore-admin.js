/**
 * Test Firebase Admin SDK Firestore Access
 * This script tests if the Firebase Admin SDK can read/write to Firestore
 */

const TEST_CONFIG = {
  serverUrl: 'http://localhost:3000',
  testUserId: 'test-user-123',
  testData: {
    uid: 'test-user-123',
    email: 'test@example.com',
    credits: 100,
    createdAt: new Date().toISOString(),
    lastLoginAt: new Date().toISOString()
  }
};

async function testFirestoreAccess() {
  console.log('🧪 Testing Firebase Admin SDK Firestore Access');
  console.log('==============================================');
  
  try {
    console.log('🔍 Testing server connection...');
    
    // Test if server is running
    const healthCheck = await fetch(`${TEST_CONFIG.serverUrl}/api/debug-providers`);
    
    if (!healthCheck.ok) {
      console.log('❌ Server not accessible');
      return;
    }
    
    console.log('✅ Server is running');
    
    // Test Firestore write operation
    console.log('🔥 Testing Firestore write operation...');
    
    const writeResponse = await fetch(`${TEST_CONFIG.serverUrl}/api/test-firestore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'write',
        collection: 'test-admin',
        docId: 'test-doc-' + Date.now(),
        data: TEST_CONFIG.testData
      })
    });
    
    if (writeResponse.ok) {
      const writeResult = await writeResponse.json();
      console.log('✅ Firestore write test successful:', writeResult);
    } else {
      const writeError = await writeResponse.text();
      console.log('❌ Firestore write test failed:', writeError);
    }
    
    // Test Firestore read operation
    console.log('🔥 Testing Firestore read operation...');
    
    const readResponse = await fetch(`${TEST_CONFIG.serverUrl}/api/test-firestore`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        action: 'read',
        collection: 'users',
        docId: TEST_CONFIG.testUserId
      })
    });
    
    if (readResponse.ok) {
      const readResult = await readResponse.json();
      console.log('✅ Firestore read test successful:', readResult);
    } else {
      const readError = await readResponse.text();
      console.log('❌ Firestore read test failed:', readError);
    }
    
  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
    console.log('🔧 TROUBLESHOOTING:');
    console.log('1. Make sure the Next.js server is running (npm run dev)');
    console.log('2. Check that Firebase Admin SDK is properly configured');
    console.log('3. Verify Firestore rules allow Admin SDK access');
    console.log('4. Check environment variables are set correctly');
  }
}

// Run the test
testFirestoreAccess(); 