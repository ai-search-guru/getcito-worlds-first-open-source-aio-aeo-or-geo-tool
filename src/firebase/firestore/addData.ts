import firebase_app from "../config";
import { getFirestore, doc, setDoc } from "firebase/firestore";
import { storeDocumentWithLargeData, exceedsFirestoreLimit } from '../storage/cloudStorage';

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Function to add data to a Firestore collection with automatic Cloud Storage handling
export default async function addData(
  collection: string,
  id: string,
  data: any
) {
  // Variable to store the result of the operation
  let result = null;
  // Variable to store any error that occurs during the operation
  let error = null;

  try {
    // Check if the data exceeds Firestore limits
    const serializedSize = JSON.stringify(data).length;
    console.log(`📊 Checking document size for ${collection}/${id}:`, {
      sizeInBytes: serializedSize,
      sizeInKB: `${(serializedSize / 1024).toFixed(2)} KB`,
      exceedsLimit: exceedsFirestoreLimit(data)
    });
    
    // If data exceeds limits, use Cloud Storage solution
    if (exceedsFirestoreLimit(data) || serializedSize > 1000000) {
      console.log(`📦 Document exceeds Firestore limits, using Cloud Storage for ${collection}/${id}`);
      
      const { success, error: storageError } = await storeDocumentWithLargeData(
        collection,
        id,
        data,
        [], // Let auto-detection find large fields
        true // Enable auto-detection
      );
      
      if (success) {
        result = { success: true, usedCloudStorage: true };
        console.log(`✅ Document stored successfully using Cloud Storage: ${collection}/${id}`);
      } else {
        throw storageError || new Error('Failed to store large document in Cloud Storage');
      }
      
    } else {
      // Use traditional Firestore storage for smaller documents
      console.log(`💾 Document fits in Firestore limits, using traditional storage for ${collection}/${id}`);
      
      result = await setDoc(doc(db, collection, id), data, {
        merge: true, // Merge the new data with existing document data
      });
      
      console.log(`✅ Document stored successfully using Firestore: ${collection}/${id}`);
    }
    
  } catch (e) {
    console.error(`❌ Error storing document ${collection}/${id}:`, e);
    
    // If we get a size error, try the Cloud Storage fallback
    if (e instanceof Error && e.message.includes('size') && e.message.includes('exceeds')) {
      console.log('🔧 Attempting Cloud Storage fallback due to size error...');
      try {
        const { success, error: storageError } = await storeDocumentWithLargeData(
          collection,
          id,
          data,
          [], // Let auto-detection find large fields
          true // Enable auto-detection
        );
        
        if (success) {
          result = { success: true, usedCloudStorage: true, fallbackUsed: true };
          console.log(`✅ Document stored successfully using Cloud Storage fallback: ${collection}/${id}`);
          error = null; // Clear the error since we succeeded with fallback
        } else {
          error = storageError || new Error('Cloud Storage fallback failed');
        }
      } catch (fallbackError) {
        error = fallbackError;
        console.error(`❌ Cloud Storage fallback also failed for ${collection}/${id}:`, fallbackError);
      }
    } else {
      // Catch and store any other error that occurs during the operation
      error = e;
    }
  }

  // Return the result and error as an object
  return { result, error };
}
