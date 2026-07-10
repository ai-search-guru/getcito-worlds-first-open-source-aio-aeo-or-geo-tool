import { 
  getFirestore,
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  orderBy,
  serverTimestamp,
  Timestamp 
} from 'firebase/firestore';
import firebase_app from '@/firebase/config';

const db = getFirestore(firebase_app);

// Type definitions
export interface AIResponse {
  provider: string;
  response: string;
  error?: string;
  timestamp: string;
  responseTime?: number;
  tokenCount?: any;
}

export interface UserQueryDocument {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  originalQuery: string;
  keyword: string;
  category: string;
  aiResponses: AIResponse[];
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  createdAt: Timestamp | any;
  updatedAt: Timestamp | any;
  processedAt?: Timestamp | any;
}

const COLLECTION_NAME = 'v8userqueries';

// Add or update a user query with AI responses
export async function addUserQuery(queryData: Omit<UserQueryDocument, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ result?: string; error?: any }> {
  try {
    const docRef = doc(collection(db, COLLECTION_NAME));
    
    await setDoc(docRef, {
      ...queryData,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    console.log('✅ User query added:', docRef.id);
    return { result: docRef.id };
  } catch (error) {
    console.error('❌ Error adding user query:', error);
    return { error };
  }
}

// Update AI responses for an existing query
export async function updateQueryResponses(
  queryId: string, 
  aiResponses: AIResponse[], 
  status: 'completed' | 'error' = 'completed'
): Promise<{ result?: boolean; error?: any }> {
  try {
    const docRef = doc(db, COLLECTION_NAME, queryId);
    
    await setDoc(docRef, {
      aiResponses,
      status,
      updatedAt: serverTimestamp(),
      processedAt: serverTimestamp(),
    }, { merge: true });

    console.log('✅ Query responses updated:', queryId);
    return { result: true };
  } catch (error) {
    console.error('❌ Error updating query responses:', error);
    return { error };
  }
}

// Get all queries for a specific brand
export async function getQueriesByBrand(brandId: string): Promise<{ result?: UserQueryDocument[]; error?: any }> {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('brandId', '==', brandId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const queries: UserQueryDocument[] = [];
    
    querySnapshot.forEach((doc) => {
      queries.push({
        id: doc.id,
        ...doc.data()
      } as UserQueryDocument);
    });

    return { result: queries };
  } catch (error) {
    console.error('❌ Error fetching queries by brand:', error);
    return { error };
  }
}

// Get all queries for a specific user
export async function getQueriesByUser(userId: string): Promise<{ result?: UserQueryDocument[]; error?: any }> {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const queries: UserQueryDocument[] = [];
    
    querySnapshot.forEach((doc) => {
      queries.push({
        id: doc.id,
        ...doc.data()
      } as UserQueryDocument);
    });

    return { result: queries };
  } catch (error) {
    console.error('❌ Error fetching queries by user:', error);
    return { error };
  }
}

// Get a single query by ID
export async function getUserQuery(queryId: string): Promise<{ result?: UserQueryDocument; error?: any }> {
  try {
    const docRef = doc(db, COLLECTION_NAME, queryId);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      return { 
        result: {
          id: docSnap.id,
          ...docSnap.data()
        } as UserQueryDocument 
      };
    } else {
      return { error: 'Query not found' };
    }
  } catch (error) {
    console.error('❌ Error fetching query:', error);
    return { error };
  }
}

// Get unprocessed queries
export async function getUnprocessedQueries(): Promise<{ result?: UserQueryDocument[]; error?: any }> {
  try {
    const q = query(
      collection(db, COLLECTION_NAME),
      where('status', 'in', ['pending', 'processing']),
      orderBy('createdAt', 'asc')
    );
    
    const querySnapshot = await getDocs(q);
    const queries: UserQueryDocument[] = [];
    
    querySnapshot.forEach((doc) => {
      queries.push({
        id: doc.id,
        ...doc.data()
      } as UserQueryDocument);
    });

    return { result: queries };
  } catch (error) {
    console.error('❌ Error fetching unprocessed queries:', error);
    return { error };
  }
} 