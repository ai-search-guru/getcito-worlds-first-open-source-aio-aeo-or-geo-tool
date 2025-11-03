import firebase_app from "../config";
import { signOut as firebaseSignOut, getAuth } from "firebase/auth";

// Get the authentication instance using the Firebase app
const auth = getAuth(firebase_app);

// Function to sign out the current user
export default async function signOut() {
  let result = null, // Variable to store the sign-out result
    error = null; // Variable to store any error that occurs

  try {
    result = await firebaseSignOut(auth); // Sign out the current user
  } catch (e) {
    error = e; // Catch and store any error that occurs during sign-out
  }

  return { result, error }; // Return the sign-out result and error (if any)
} 