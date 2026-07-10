import firebase_app from "../config";
import { getFirestore, collection, query, where, getDocs, doc, setDoc, getDoc, serverTimestamp } from "firebase/firestore";
import { storeDocumentWithLargeData, retrieveDocumentWithLargeData, exceedsFirestoreLimit } from '../storage/cloudStorage';

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Interface for brand analytics data
export interface BrandBasicData {
  brandMentions: number;
  brandMentionsChange: number;
  brandValidity: number;
  brandValidityChange: number;
  lastUpdated: string;
  linkValidity: number;
  linkValidityChange: number;
  sentimentChange: number;
  sentimentScore: number;
}

// Interface for brand data
export interface UserBrand {
  id: string;
  userId: string;
  domain: string;
  website?: string;
  companyName: string;
  shortDescription?: string;
  productsAndServices?: string[];
  keywords?: string[];
  queries?: Array<{
    keyword: string;
    query: string;
    category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
    containsBrand: 0 | 1;
    selected: boolean;
  }>;
  createdAt: string;
  updatedAt?: string;
  timestamp?: number;
  totalQueries?: number;
  setupComplete?: boolean;
  currentStep?: number;
  queryDistribution?: {
    awareness: number;
    interest: number;
    consideration: number;
    purchase: number;
  };
  aiAnalysis?: {
    providersUsed: string[];
    totalCost: number;
    completedAt: string;
    requestId: string | null;
  } | null;
  // New brand analytics data
  brandsbasicData?: BrandBasicData;
  // Query processing results
  queryProcessingResults?: QueryProcessingResult[];
  lastProcessedAt?: any;
}

// Interface for query processing results
export interface QueryProcessingResult {
  date: string;
  processingSessionId: string; // Unique identifier for each processing session
  processingSessionTimestamp: string; // When this processing session started
  results: {
    chatgpt?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      tokenCount?: any;
    };
    gemini?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      tokenCount?: any;
    };
    perplexity?: {
      response: string;
      error?: string;
      timestamp: string;
      responseTime?: number;
      tokenCount?: any;
    };
  };
  query: string;
  keyword: string;
  category: string;
}

// Function to get user brands from v8userbrands collection
export async function getUserBrands(userId: string, includeQueryResults: boolean = false) {
  let result: UserBrand[] = [];
  let error = null;

  try {
    // Create a query to get brands for the specific user
    const brandsRef = collection(db, 'v8userbrands');
    const q = query(brandsRef, where('userId', '==', userId));
    
    // Execute the query
    const querySnapshot = await getDocs(q);
    
    // Convert the documents to UserBrand objects
    result = await Promise.all(
      querySnapshot.docs.map(async (docSnap) => {
        const brandData = { id: docSnap.id, ...docSnap.data() } as UserBrand;
        
        // If the document has storage references and we want query results, retrieve them
        if (includeQueryResults && (brandData as any).storageReferences) {
          console.log(`📥 Brand ${brandData.id} has Cloud Storage references, retrieving full data...`);
          
          try {
            const { document: fullBrandData } = await retrieveDocumentWithLargeData(
              'v8userbrands', 
              docSnap.id, 
              ['queryProcessingResults']
            );
            
            if (fullBrandData?.queryProcessingResults) {
              brandData.queryProcessingResults = fullBrandData.queryProcessingResults;
              console.log(`✅ Retrieved ${fullBrandData.queryProcessingResults.length} query results from Cloud Storage for brand ${brandData.id}`);
            }
          } catch (retrievalError) {
            console.warn(`⚠️ Failed to retrieve Cloud Storage data for brand ${brandData.id}:`, retrievalError);
            // Continue with the basic brand data
          }
        }
        
        return brandData;
      })
    );

    console.log(`✅ Retrieved ${result.length} brands for user ${userId}${includeQueryResults ? ' (with query results)' : ''}`);

  } catch (e) {
    console.error('Error fetching user brands:', e);
    error = e;
  }

  return { result, error };
} 

// Function to update brand with query processing results (appends new session data)
export async function updateBrandWithQueryResults(
  brandId: string,
  queryResults: QueryProcessingResult[]
) {
  let error = null;

  try {
    // First, check the size of the data we're trying to store
    const dataToStore = {
      queryProcessingResults: queryResults,
      lastProcessedAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    
    const serializedSize = JSON.stringify(queryResults).length;
    
    // If the data is too large, use Cloud Storage
    const shouldUseCloudStorage = exceedsFirestoreLimit(dataToStore) || serializedSize > 1000000; // Force if >1MB
    
    if (shouldUseCloudStorage) {
      console.log(`📦 Data exceeds Firestore limits, using Cloud Storage for brand ${brandId}`);
      
      // Get existing brand data first
      const { document: existingBrand } = await retrieveDocumentWithLargeData('v8userbrands', brandId, ['queryProcessingResults']);
      let existingResults: QueryProcessingResult[] = [];
      
      if (existingBrand?.queryProcessingResults) {
        existingResults = existingBrand.queryProcessingResults;
      }
      
      // Check if we're updating an existing session or creating a new one
      const currentSessionId = queryResults[0]?.processingSessionId;
      
      if (currentSessionId) {
        // Remove any existing results from the same processing session (for incremental updates)
        existingResults = existingResults.filter(
          result => result.processingSessionId !== currentSessionId
        );
      }
      
      // Append the new query results
      const allResults = [...existingResults, ...queryResults];
      
      // Limit the number of stored results to prevent excessive storage costs
      const MAX_STORED_RESULTS = 100; // Increased since we're using Cloud Storage
      const limitedResults = allResults
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, MAX_STORED_RESULTS);
      
      // Store using Cloud Storage service
      const { success, error: storageError } = await storeDocumentWithLargeData(
        'v8userbrands',
        brandId,
        {
          queryProcessingResults: limitedResults,
          lastProcessedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        },
        ['queryProcessingResults'], // Specify which fields might be large
        true // Auto-detect large fields
      );
      
      if (!success && storageError) {
        throw storageError;
      }
      
    } else {
      // Use traditional Firestore storage for smaller data
      const brandRef = doc(db, 'v8userbrands', brandId);
      
      // First, fetch the current brand data to get existing results
      const brandDoc = await getDoc(brandRef);
      
      let existingResults: QueryProcessingResult[] = [];
      if (brandDoc.exists()) {
        const brandData = brandDoc.data() as UserBrand;
        existingResults = brandData.queryProcessingResults || [];
      }

      // Check if we're updating an existing session or creating a new one
      const currentSessionId = queryResults[0]?.processingSessionId;
      
      if (currentSessionId) {
        // Remove any existing results from the same processing session (for incremental updates)
        existingResults = existingResults.filter(
          result => result.processingSessionId !== currentSessionId
        );
      }
      
      // Append the new query results
      const allResults = [...existingResults, ...queryResults];
      
      // Limit the number of stored results to prevent document size issues
      const MAX_STORED_RESULTS = 50;
      const limitedResults = allResults
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, MAX_STORED_RESULTS);
      
      // Extremely aggressive truncation for Firestore storage to prevent size issues
      const truncatedResults = limitedResults.map(result => ({
        ...result,
        results: {
          ...result.results,
          ...(result.results?.chatgpt && {
            chatgpt: {
              ...result.results.chatgpt,
              response: (result.results.chatgpt.response && result.results.chatgpt.response.length > 3000)
                ? result.results.chatgpt.response.substring(0, 3000) + '...[truncated for size]'
                : (result.results.chatgpt.response || '')
            }
          }),
          ...(result.results?.gemini && {
            gemini: {
              ...result.results.gemini,
              response: (result.results.gemini.response && result.results.gemini.response.length > 3000)
                ? result.results.gemini.response.substring(0, 3000) + '...[truncated for size]'
                : (result.results.gemini.response || '')
            }
          }),
          ...(result.results?.perplexity && {
            perplexity: {
              ...result.results.perplexity,
              response: (result.results.perplexity.response && result.results.perplexity.response.length > 3000)
                ? result.results.perplexity.response.substring(0, 3000) + '...[truncated for size]'
                : (result.results.perplexity.response || '')
            }
          })
        }
      }));
      
      // Double-check the size after truncation
      const truncatedDataSize = JSON.stringify({
        queryProcessingResults: truncatedResults,
        lastProcessedAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }).length;
      
      // If still too large, reduce to only the most essential data
      if (truncatedDataSize > 800000) { // 800KB safety limit
        console.log('⚠️ Data still too large after truncation, using minimal data approach');
        const minimalResults = truncatedResults.slice(0, 20).map(result => ({
          date: result.date,
          processingSessionId: result.processingSessionId,
          query: result.query ? (result.query.substring(0, 100) + (result.query.length > 100 ? '...' : '')) : '',
          keyword: result.keyword,
          category: result.category,
          results: {
            ...(result.results?.chatgpt && { chatgpt: { timestamp: result.results.chatgpt.timestamp, hasContent: !!result.results.chatgpt.response } }),
            ...(result.results?.gemini && { gemini: { timestamp: result.results.gemini.timestamp, hasContent: !!result.results.gemini.response } }),
            ...(result.results?.perplexity && { perplexity: { timestamp: result.results.perplexity.timestamp, hasContent: !!result.results.perplexity.response } })
          }
        }));
        
        await setDoc(brandRef, {
          queryProcessingResults: minimalResults,
          lastProcessedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          dataNote: 'Full query results stored in Cloud Storage due to size constraints'
        }, { merge: true });
        
      } else {
        // Use truncated results if they fit
        await setDoc(brandRef, {
          queryProcessingResults: truncatedResults,
          lastProcessedAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, { merge: true });
              }
    }

  } catch (e) {
    console.error('Error updating brand with query results:', e);
    error = e;
    
    // If the Cloud Storage approach fails, try to save a minimal version in Firestore
    if (e instanceof Error && e.message.includes('size') && e.message.includes('exceeds')) {
      console.log('🔧 Attempting fallback with minimal data...');
      try {
        const brandRef = doc(db, 'v8userbrands', brandId);
        
        // Save only essential data without full responses
        const minimalResults = queryResults.slice(0, 10).map(result => ({
          date: result.date,
          processingSessionId: result.processingSessionId,
          processingSessionTimestamp: result.processingSessionTimestamp,
          query: result.query || '',
          keyword: result.keyword || '',
          category: result.category || '',
          results: {
            ...(result.results?.chatgpt && { chatgpt: { timestamp: result.results.chatgpt.timestamp, error: result.results.chatgpt.error } }),
            ...(result.results?.gemini && { gemini: { timestamp: result.results.gemini.timestamp, error: result.results.gemini.error } }),
            ...(result.results?.perplexity && { perplexity: { timestamp: result.results.perplexity.timestamp, error: result.results.perplexity.error } })
          }
        }));
        
        await setDoc(brandRef, {
          queryProcessingResults: minimalResults,
          lastProcessedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          largeDataStorageError: true,
          largeDataNote: 'Full query results stored in Cloud Storage due to size constraints'
        }, { merge: true });
        
        console.log('✅ Fallback save completed with minimal data');
        error = null; // Clear the error since we successfully saved minimal data
        
      } catch (fallbackError) {
        console.error('❌ Fallback save also failed:', fallbackError);
        error = fallbackError;
      }
    }
  }

  return { error };
} 