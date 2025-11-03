import * as admin from 'firebase-admin';

// Initialize Firebase Admin SDK if not already initialized
if (!admin.apps.length) {
  try {
    // Validate required environment variables
    const requiredEnvVars = [
      'NEXT_PUBLIC_FIREBASE_PROJECT_ID',
      'FIREBASE_CLIENT_EMAIL', 
      'FIREBASE_PRIVATE_KEY'
    ];
    
    const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
    }

    // Clean and format the private key
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
    
    if (!privateKey) {
      throw new Error('FIREBASE_PRIVATE_KEY is empty or invalid');
    }

    const adminConfig = {
      credential: admin.credential.cert({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: privateKey,
      }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    };

    admin.initializeApp(adminConfig);
    
    console.log('✅ Firebase Admin SDK initialized successfully');
    console.log('📋 Project ID:', process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID);
    console.log('📋 Client Email:', process.env.FIREBASE_CLIENT_EMAIL?.substring(0, 20) + '...');
    
  } catch (error) {
    console.error('❌ Firebase Admin SDK initialization error:', error);
    throw error;
  }
}

// Export Firebase Admin services with error handling
export const firestore = admin.firestore();
export const auth = admin.auth();
export const adminApp = admin.app();

// Helper function to test Firestore connection
export async function testFirestoreConnection(): Promise<boolean> {
  try {
    // Try to read from a test collection
    const testDoc = await firestore.collection('test').limit(1).get();
    console.log('✅ Firestore connection test successful');
    return true;
  } catch (error) {
    console.error('❌ Firestore connection test failed:', error);
    return false;
  }
}

export default admin; 