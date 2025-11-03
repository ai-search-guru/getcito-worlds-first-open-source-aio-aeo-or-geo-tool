import firebase_app from "../config";
import { createUserWithEmailAndPassword, getAuth, updateProfile } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

// Function to sign up a user with email and password
export default async function signUp(email: string, password: string, displayName?: string) {
  let result = null, // Variable to store the sign-up result
    error = null; // Variable to store any error that occurs

  try {
    result = await createUserWithEmailAndPassword(auth, email, password); // Create a new user with email and password
    
    // Update the user's display name if provided
    if (result.user && displayName) {
      await updateProfile(result.user, {
        displayName: displayName
      });
      console.log('✅ User display name updated:', displayName);
    }
    
    console.log('🎉 New user account created:', email);
  } catch (e) {
    error = e; // Catch and store any error that occurs during sign-up
    console.error('❌ Sign-up error:', e);
  }

  return { result, error }; // Return the sign-up result and error (if any)
}
