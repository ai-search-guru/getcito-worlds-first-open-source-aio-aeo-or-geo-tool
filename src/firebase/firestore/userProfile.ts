import firebase_app from "../config";
import { getFirestore, doc, setDoc, getDoc, updateDoc, increment } from "firebase/firestore";
import { User } from "firebase/auth";

// Get the Firestore instance
const db = getFirestore(firebase_app);

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  credits: number;
  createdAt: string;
  lastLoginAt: string;
  isNewUser?: boolean;
}

// Create or update user profile in Firestore
export async function createUserProfile(user: User, isNewUser: boolean = false): Promise<{ result: UserProfile | null; error: any }> {
  let result = null;
  let error = null;

  try {
    const userRef = doc(db, 'users', user.uid);
    const userDoc = await getDoc(userRef);
    
    const now = new Date().toISOString();
    
    if (!userDoc.exists() || isNewUser) {
      // Create new user profile with 500 credits
      const userProfile: Partial<UserProfile> = {
        uid: user.uid,
        email: user.email || '',
        displayName: user.displayName || user.email?.split('@')[0] || 'User',
        credits: 500, // Give 500 credits to new users
        createdAt: now,
        lastLoginAt: now,
        isNewUser: true
      };
      
      // Only add photoURL if it exists
      if (user.photoURL) {
        userProfile.photoURL = user.photoURL;
      }
      
      await setDoc(userRef, userProfile);
      result = userProfile as UserProfile;
      console.log('🎉 New user created with 500 credits:', user.email);
    } else {
      // Update existing user's last login
      const existingData = userDoc.data() as UserProfile;
      const updateData: Partial<UserProfile> = {
        email: user.email || existingData.email,
        displayName: user.displayName || existingData.displayName,
        lastLoginAt: now,
        isNewUser: false
      };
      
      // Only update photoURL if it exists
      if (user.photoURL) {
        updateData.photoURL = user.photoURL;
      }
      
      await updateDoc(userRef, updateData);
      
      result = {
        ...existingData,
        ...updateData
      } as UserProfile;
      console.log('👤 Existing user profile updated:', user.email);
    }
  } catch (e) {
    error = e;
    console.error('❌ Error creating/updating user profile:', e);
  }

  return { result, error };
}

// Get user profile from Firestore
export async function getUserProfile(uid: string): Promise<{ result: UserProfile | null; error: any }> {
  let result = null;
  let error = null;

  try {
    const userRef = doc(db, 'users', uid);
    const userDoc = await getDoc(userRef);
    
    if (userDoc.exists()) {
      result = userDoc.data() as UserProfile;
    }
  } catch (e) {
    error = e;
    console.error('❌ Error fetching user profile:', e);
  }

  return { result, error };
}

// Update user credits
export async function updateUserCredits(uid: string, creditsChange: number): Promise<{ result: boolean; error: any }> {
  let result = false;
  let error = null;

  try {
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      credits: increment(creditsChange)
    });
    result = true;
    console.log(`💰 User credits updated: ${creditsChange > 0 ? '+' : ''}${creditsChange}`);
  } catch (e) {
    error = e;
    console.error('❌ Error updating user credits:', e);
  }

  return { result, error };
}

// Deduct credits for operations
export async function deductCredits(uid: string, amount: number): Promise<{ result: boolean; error: any }> {
  return updateUserCredits(uid, -amount);
}

// Add credits (for purchases, bonuses, etc.)
export async function addCredits(uid: string, amount: number): Promise<{ result: boolean; error: any }> {
  return updateUserCredits(uid, amount);
} 