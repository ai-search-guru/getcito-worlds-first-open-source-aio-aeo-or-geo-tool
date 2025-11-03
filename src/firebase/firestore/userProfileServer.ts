import { firestore } from '../firebase-admin';
import { UserProfile } from './userProfile';
import * as admin from 'firebase-admin';

// Server-side user profile functions using Firebase Admin SDK

// Get user profile from Firestore using Admin SDK
export async function getUserProfileServer(uid: string): Promise<{ result: UserProfile | null; error: any }> {
  let result = null;
  let error = null;

  try {
    console.log('🔍 Fetching user profile from Firestore (Admin SDK):', uid);
    const userRef = firestore.collection('users').doc(uid);
    const userDoc = await userRef.get();
    
    if (userDoc.exists) {
      result = userDoc.data() as UserProfile;
      console.log('✅ User profile fetched successfully:', {
        uid: result.uid,
        email: result.email,
        credits: result.credits
      });
    } else {
      console.log('❌ User profile not found for UID:', uid);
    }
  } catch (e) {
    error = e;
    console.error('❌ Error fetching user profile (Admin SDK):', e);
  }

  return { result, error };
}

// Update user credits using Admin SDK
export async function updateUserCreditsServer(uid: string, creditsChange: number): Promise<{ result: boolean; error: any }> {
  let result = false;
  let error = null;

  try {
    console.log(`💰 Updating user credits (Admin SDK): ${creditsChange > 0 ? '+' : ''}${creditsChange} for user ${uid}`);
    
    const userRef = firestore.collection('users').doc(uid);
    
    try {
      // Use Admin SDK's FieldValue.increment - correct syntax
      await userRef.update({
        credits: admin.firestore.FieldValue.increment(creditsChange)
      });
      
      result = true;
      console.log(`✅ User credits updated successfully using increment: ${creditsChange > 0 ? '+' : ''}${creditsChange}`);
    } catch (incrementError) {
      console.log('⚠️ FieldValue.increment failed, using manual update method...');
      
      // Fallback: Get current credits and update manually
      const userDoc = await userRef.get();
      
      if (!userDoc.exists) {
        throw new Error('User document does not exist');
      }
      
      const currentData = userDoc.data() as UserProfile;
      const currentCredits = currentData.credits || 0;
      const newCredits = currentCredits + creditsChange;
      
      // Prevent negative credits
      if (newCredits < 0) {
        throw new Error(`Insufficient credits: ${currentCredits} available, ${Math.abs(creditsChange)} required`);
      }
      
      await userRef.update({
        credits: newCredits
      });
      
      result = true;
      console.log(`✅ User credits updated successfully using manual method: ${currentCredits} → ${newCredits}`);
    }
  } catch (e) {
    error = e;
    console.error('❌ Error updating user credits (Admin SDK):', e);
  }

  return { result, error };
}

// Deduct credits for operations using Admin SDK
export async function deductCreditsServer(uid: string, amount: number): Promise<{ result: boolean; error: any }> {
  console.log(`🔄 Deducting ${amount} credits for user ${uid}`);
  const result = await updateUserCreditsServer(uid, -amount);
  
  if (result.result) {
    console.log(`✅ Successfully deducted ${amount} credits from user ${uid}`);
  } else {
    console.error(`❌ Failed to deduct ${amount} credits from user ${uid}:`, result.error);
  }
  
  return result;
}

// Add credits (for purchases, bonuses, etc.) using Admin SDK
export async function addCreditsServer(uid: string, amount: number): Promise<{ result: boolean; error: any }> {
  console.log(`🔄 Adding ${amount} credits for user ${uid}`);
  return updateUserCreditsServer(uid, amount);
}

// Create or update user profile using Admin SDK
export async function createUserProfileServer(userData: any, isNewUser: boolean = false): Promise<{ result: UserProfile | null; error: any }> {
  let result = null;
  let error = null;

  try {
    const userRef = firestore.collection('users').doc(userData.uid);
    const userDoc = await userRef.get();
    
    const now = new Date().toISOString();
    
    if (!userDoc.exists || isNewUser) {
      // Create new user profile with 500 credits
      const userProfile: Partial<UserProfile> = {
        uid: userData.uid,
        email: userData.email || '',
        displayName: userData.displayName || userData.email?.split('@')[0] || 'User',
        credits: 500, // Give 500 credits to new users
        createdAt: now,
        lastLoginAt: now,
        isNewUser: true
      };
      
      // Only add photoURL if it exists
      if (userData.photoURL) {
        userProfile.photoURL = userData.photoURL;
      }
      
      await userRef.set(userProfile);
      result = userProfile as UserProfile;
      console.log('🎉 New user created with 500 credits (Admin SDK):', userData.email);
    } else {
      // Update existing user's last login
      const existingData = userDoc.data() as UserProfile;
      const updateData: Partial<UserProfile> = {
        email: userData.email || existingData.email,
        displayName: userData.displayName || existingData.displayName,
        lastLoginAt: now,
        isNewUser: false
      };
      
      // Only update photoURL if it exists
      if (userData.photoURL) {
        updateData.photoURL = userData.photoURL;
      }
      
      await userRef.update(updateData);
      
      result = {
        ...existingData,
        ...updateData
      } as UserProfile;
      console.log('👤 Existing user profile updated (Admin SDK):', userData.email);
    }
  } catch (e) {
    error = e;
    console.error('❌ Error creating/updating user profile (Admin SDK):', e);
  }

  return { result, error };
}

// Get user's current credit balance using Admin SDK
export async function getUserCreditsServer(uid: string): Promise<{ result: number; error: any }> {
  let result = 0;
  let error = null;

  try {
    const { result: profile, error: profileError } = await getUserProfileServer(uid);
    
    if (profileError || !profile) {
      error = profileError || new Error('User profile not found');
      return { result, error };
    }
    
    result = profile.credits || 0;
    console.log(`💰 Current credits for user ${uid}: ${result}`);
  } catch (e) {
    error = e;
    console.error('❌ Error getting user credits (Admin SDK):', e);
  }

  return { result, error };
} 