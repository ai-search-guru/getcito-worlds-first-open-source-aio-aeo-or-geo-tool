import { getAuth, onAuthStateChanged } from 'firebase/auth';
import firebase_app from '@/firebase/config';

// Initialize Firebase auth instance
const auth = getAuth(firebase_app);

/**
 * Wait for Firebase auth to be ready
 * @returns Promise<User | null> - The authenticated user or null
 */
function waitForAuthReady(): Promise<any> {
  return new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

/**
 * Get the Firebase ID token for the currently authenticated user
 * @returns Promise<string | null> - The ID token or null if not authenticated
 */
export async function getFirebaseIdToken(): Promise<string | null> {
  try {
    // Wait for auth to be ready
    const user = await waitForAuthReady();
    
    if (!user) {
      console.warn('⚠️ No authenticated user found');
      return null;
    }

    // Get the ID token (this will refresh if needed)
    const idToken = await user.getIdToken();
    
    return idToken;
    
  } catch (error) {
    console.error('❌ Error getting Firebase ID token:', error);
    return null;
  }
}

/**
 * Get Firebase ID token with retry logic
 * @param maxRetries - Maximum number of retries (default: 3)
 * @param delay - Delay between retries in ms (default: 1000)
 * @returns Promise<string | null>
 */
export async function getFirebaseIdTokenWithRetry(
  maxRetries: number = 3, 
  delay: number = 1000
): Promise<string | null> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const token = await getFirebaseIdToken();
      if (token) {
        return token;
      }
      
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  return null;
} 