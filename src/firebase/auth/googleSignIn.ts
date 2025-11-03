import firebase_app from "../config";
import { signInWithPopup, GoogleAuthProvider, getAuth } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

// Create a Google Auth Provider instance
const googleProvider = new GoogleAuthProvider();

// Function to sign in with Google
export default async function googleSignIn() {
  let result = null, // Variable to store the sign-in result
    error = null; // Variable to store any error that occurs

  try {
    result = await signInWithPopup(auth, googleProvider); // Sign in with Google popup
    console.log('✅ Google sign-in successful:', result.user.email);
  } catch (e) {
    error = e; // Catch and store any error that occurs during sign-in
    console.error('❌ Google sign-in error:', e);
  }

  return { result, error }; // Return the sign-in result and error (if any)
} 