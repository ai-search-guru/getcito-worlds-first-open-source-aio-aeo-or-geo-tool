import { getStorage, ref, uploadBytes, getDownloadURL, deleteObject, getMetadata } from 'firebase/storage';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import firebase_app from '../config';
import { db } from '../config';

// Initialize Firebase Storage
const storage = getStorage(firebase_app);

// Interface for Cloud Storage metadata stored in Firestore
export interface StorageReference {
  storageId: string;
  storagePath: string;
  downloadUrl: string;
  size: number;
  contentType: string;
  uploadedAt: any;
  metadata?: {
    originalDataType: string;
    compressionUsed?: boolean;
    originalSize?: number;
  };
}

// Interface for documents that reference Cloud Storage
export interface DocumentWithStorage {
  id?: string;
  storageReferences?: {
    [key: string]: StorageReference;
  };
  // Regular document fields
  [key: string]: any;
}

/**
 * Check if data size exceeds Firestore limits
 * Firestore has a 1MB document size limit
 */
export function exceedsFirestoreLimit(data: any): boolean {
  const serialized = JSON.stringify(data);
  const sizeInBytes = new Blob([serialized]).size;
  const FIRESTORE_LIMIT = 1048576; // 1MB in bytes
  const SAFETY_MARGIN = 0.8; // Use 80% of limit for safety
  
  return sizeInBytes > (FIRESTORE_LIMIT * SAFETY_MARGIN);
}

/**
 * Store large data in Cloud Storage and return a reference
 */
export async function storeLargeData(
  data: any,
  path: string,
  dataType: string,
  metadata?: Record<string, any>
): Promise<{ storageRef?: StorageReference; error?: any }> {
  try {
    // Generate unique storage path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const storageId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;
    const storagePath = `${path}/${storageId}.json`;
    
    // Compress data if needed
    const serializedData = JSON.stringify(data, null, 0); // No formatting to save space
    const originalSize = new Blob([serializedData]).size;
    
    console.log(`📦 Storing large data in Cloud Storage:`, {
      path: storagePath,
      originalSize: `${(originalSize / 1024).toFixed(2)} KB`,
      dataType
    });
    
    // Create storage reference and upload data
    const storageRef = ref(storage, storagePath);
    const uploadMetadata = {
      contentType: 'application/json',
      customMetadata: {
        dataType,
        originalSize: originalSize.toString(),
        uploadedAt: new Date().toISOString(),
        ...metadata
      }
    };
    
    // Upload data as JSON blob
    const blob = new Blob([serializedData], { type: 'application/json' });
    const uploadResult = await uploadBytes(storageRef, blob, uploadMetadata);
    
    // Get download URL
    const downloadUrl = await getDownloadURL(storageRef);
    
    // Create storage reference object
    const storageReference: StorageReference = {
      storageId,
      storagePath,
      downloadUrl,
      size: originalSize,
      contentType: 'application/json',
      uploadedAt: serverTimestamp(),
      metadata: {
        originalDataType: dataType,
        originalSize,
        compressionUsed: false
      }
    };
    
    console.log(`✅ Large data stored successfully:`, {
      storageId,
      downloadUrl,
      size: `${(originalSize / 1024).toFixed(2)} KB`
    });
    
    return { storageRef: storageReference };
    
  } catch (error) {
    console.error('❌ Error storing large data:', error);
    return { error };
  }
}

/**
 * Retrieve large data from Cloud Storage using a reference
 */
export async function retrieveLargeData(
  storageRef: StorageReference
): Promise<{ data?: any; error?: any }> {
  try {
    console.log(`📥 Retrieving large data from Cloud Storage:`, {
      storageId: storageRef.storageId,
      size: `${(storageRef.size / 1024).toFixed(2)} KB`
    });
    
    // Fetch data from download URL
    const response = await fetch(storageRef.downloadUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch data: ${response.status} ${response.statusText}`);
    }
    
    const jsonData = await response.json();
    
    console.log(`✅ Large data retrieved successfully:`, {
      storageId: storageRef.storageId,
      dataSize: `${(storageRef.size / 1024).toFixed(2)} KB`
    });
    
    return { data: jsonData };
    
  } catch (error) {
    console.error('❌ Error retrieving large data:', error);
    return { error };
  }
}

/**
 * Store document with automatic large data handling
 * Automatically moves large fields to Cloud Storage
 */
export async function storeDocumentWithLargeData(
  collectionName: string,
  documentId: string,
  documentData: any,
  largeDataFields: string[] = [],
  autoDetectLargeFields: boolean = true
): Promise<{ success: boolean; error?: any; storageReferences?: Record<string, StorageReference> }> {
  try {
    const docData = { ...documentData };
    const storageReferences: Record<string, StorageReference> = {};
    
    // Auto-detect large fields if enabled
    if (autoDetectLargeFields) {
      for (const [key, value] of Object.entries(docData)) {
        if (value && typeof value === 'object' && exceedsFirestoreLimit(value)) {
          largeDataFields.push(key);
        }
      }
    }
    
    // Process each large data field
    for (const fieldName of largeDataFields) {
      if (docData[fieldName]) {
        const { storageRef, error } = await storeLargeData(
          docData[fieldName],
          `${collectionName}/${documentId}`,
          fieldName,
          { documentId, fieldName }
        );
        
        if (error) {
          console.error(`❌ Failed to store large field ${fieldName}:`, error);
          return { success: false, error };
        }
        
        if (storageRef) {
          // Replace large data with storage reference
          delete docData[fieldName];
          storageReferences[fieldName] = storageRef;
        }
      }
    }
    
    // Add storage references to document
    if (Object.keys(storageReferences).length > 0) {
      docData.storageReferences = storageReferences;
    }
    
    // Store document in Firestore
    const docRef = doc(db, collectionName, documentId);
    await setDoc(docRef, {
      ...docData,
      updatedAt: serverTimestamp()
    }, { merge: true });
    
    console.log(`✅ Document stored with large data handling:`, {
      documentId,
      collection: collectionName,
      largeFieldsStored: Object.keys(storageReferences).length,
      storageReferences: Object.keys(storageReferences)
    });
    
    return { success: true, storageReferences };
    
  } catch (error) {
    console.error('❌ Error storing document with large data:', error);
    return { success: false, error };
  }
}

/**
 * Retrieve document with automatic large data reconstruction
 */
export async function retrieveDocumentWithLargeData(
  collectionName: string,
  documentId: string,
  fieldsToRetrieve?: string[]
): Promise<{ document?: DocumentWithStorage; error?: any }> {
  try {
    console.log(`📥 Retrieving document with large data:`, {
      collection: collectionName,
      documentId,
      fieldsToRetrieve
    });
    
    // Get document from Firestore
    const docRef = doc(db, collectionName, documentId);
    const docSnap = await getDoc(docRef);
    
    if (!docSnap.exists()) {
      return { error: 'Document not found' };
    }
    
    const docData = { id: docSnap.id, ...docSnap.data() } as DocumentWithStorage;
    
    // Retrieve large data from storage if references exist
    if (docData.storageReferences) {
      for (const [fieldName, storageRef] of Object.entries(docData.storageReferences)) {
        // Only retrieve specific fields if specified
        if (!fieldsToRetrieve || fieldsToRetrieve.includes(fieldName)) {
          const { data, error } = await retrieveLargeData(storageRef);
          
          if (error) {
            console.warn(`⚠️ Failed to retrieve large field ${fieldName}:`, error);
            continue;
          }
          
          // Restore large data to document
          docData[fieldName] = data;
        }
      }
    }
    
    console.log(`✅ Document retrieved with large data:`, {
      documentId,
      hasStorageReferences: !!docData.storageReferences,
      retrievedFields: fieldsToRetrieve || 'all'
    });
    
    return { document: docData };
    
  } catch (error) {
    console.error('❌ Error retrieving document with large data:', error);
    return { error };
  }
}

/**
 * Clean up storage references when document is deleted
 */
export async function deleteDocumentWithLargeData(
  collectionName: string,
  documentId: string
): Promise<{ success: boolean; error?: any }> {
  try {
    // First retrieve document to get storage references
    const { document, error } = await retrieveDocumentWithLargeData(collectionName, documentId);
    
    if (error) {
      console.warn('⚠️ Could not retrieve document for cleanup:', error);
      return { success: false, error };
    }
    
    // Delete storage references
    if (document?.storageReferences) {
      for (const [fieldName, storageRef] of Object.entries(document.storageReferences)) {
        try {
          const storageRefObj = ref(storage, storageRef.storagePath);
          await deleteObject(storageRefObj);
          console.log(`✅ Deleted storage file: ${storageRef.storagePath}`);
        } catch (storageError) {
          console.warn(`⚠️ Failed to delete storage file ${storageRef.storagePath}:`, storageError);
        }
      }
    }
    
    // Delete Firestore document
    const docRef = doc(db, collectionName, documentId);
    await deleteDoc(docRef);
    
    console.log(`✅ Document and associated storage deleted: ${documentId}`);
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error deleting document with large data:', error);
    return { success: false, error };
  }
}

/**
 * Get storage usage statistics
 */
export async function getStorageStats(
  collectionName: string,
  documentId?: string
): Promise<{ stats?: any; error?: any }> {
  try {
    const path = documentId ? `${collectionName}/${documentId}` : collectionName;
    const storageRef = ref(storage, path);
    
    // This would require listing files which needs Admin SDK
    // For now, return basic info from Firestore documents
    console.log('📊 Storage stats not fully implemented - requires Admin SDK');
    
    return { stats: { message: 'Storage stats require Admin SDK implementation' } };
    
  } catch (error) {
    console.error('❌ Error getting storage stats:', error);
    return { error };
  }
} 