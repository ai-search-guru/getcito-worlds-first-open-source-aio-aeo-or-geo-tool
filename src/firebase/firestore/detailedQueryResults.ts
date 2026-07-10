import firebase_app from "../config";
import { getFirestore, collection, doc, setDoc, getDocs, query, where, orderBy, limit, serverTimestamp } from "firebase/firestore";

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Helper function to filter out undefined values from objects
function filterUndefinedValues(obj: any): any {
  const filtered: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      filtered[key] = value;
    }
  }
  return filtered;
}

// Interface for detailed query results stored separately
export interface DetailedQueryResult {
  id?: string;
  userId: string;
  brandId: string;
  brandName: string;
  processingSessionId: string;
  processingSessionTimestamp: string;
  query: string;
  keyword: string;
  category: string;
  date: string;
  
  // Full provider responses (not truncated)
  chatgptResult?: {
    response: string;
    error?: string;
    timestamp: string;
    responseTime?: number;
    webSearchUsed?: boolean;
    citations?: number;
  };
  
  googleAIResult?: {
    response: string;
    error?: string;
    timestamp: string;
    responseTime?: number;
    totalItems?: number;
    organicResults?: number;
    peopleAlsoAsk?: number;
    location?: string;
    aiOverview?: string;
    aiOverviewReferences?: any[];
    hasAIOverview?: boolean;
    serpFeatures?: any[];
    relatedSearches?: any[];
    videoResults?: any[];
    rawDataForSEOResponse?: any;
  };
  
  perplexityResult?: {
    response: string;
    error?: string;
    timestamp: string;
    responseTime?: number;
    citations?: number;
    realTimeData?: boolean;
    citationsList?: any[];
    searchResults?: any[];
    structuredCitations?: any[];
    metadata?: any;
    usage?: any;
  };
  
  createdAt?: any;
  updatedAt?: any;
}

// Save detailed query results to separate collection
export async function saveDetailedQueryResults(
  brandId: string,
  userId: string,
  brandName: string,
  queryResults: any[]
): Promise<{ success: boolean; error?: any }> {
  try {
    const batch = [];
    
    for (const result of queryResults) {
      const docRef = doc(collection(db, 'v8detailed_query_results'));
      
      const detailedResult: DetailedQueryResult = {
        userId,
        brandId,
        brandName,
        processingSessionId: result.processingSessionId,
        processingSessionTimestamp: result.processingSessionTimestamp,
        query: result.query,
        keyword: result.keyword,
        category: result.category,
        date: result.date,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      
      // Store full ChatGPT results
      if (result.results?.chatgpt) {
        detailedResult.chatgptResult = filterUndefinedValues({
          response: result.results.chatgpt.response,
          error: result.results.chatgpt.error,
          timestamp: result.results.chatgpt.timestamp,
          responseTime: result.results.chatgpt.responseTime,
          webSearchUsed: result.results.chatgpt.webSearchUsed,
          citations: result.results.chatgpt.citations
        });
      }
      
      // Store full Google AI results
      if (result.results?.googleAI) {
        detailedResult.googleAIResult = filterUndefinedValues({
          response: result.results.googleAI.response,
          error: result.results.googleAI.error,
          timestamp: result.results.googleAI.timestamp,
          responseTime: result.results.googleAI.responseTime,
          totalItems: result.results.googleAI.totalItems,
          organicResults: result.results.googleAI.organicResults,
          peopleAlsoAsk: result.results.googleAI.peopleAlsoAsk,
          location: result.results.googleAI.location,
          aiOverview: result.results.googleAI.aiOverview,
          hasAIOverview: result.results.googleAI.hasAIOverview
          // Note: Arrays are stored here since this is a separate collection
        });
      }
      
      // Store full Perplexity results
      if (result.results?.perplexity) {
        detailedResult.perplexityResult = filterUndefinedValues({
          response: result.results.perplexity.response,
          error: result.results.perplexity.error,
          timestamp: result.results.perplexity.timestamp,
          responseTime: result.results.perplexity.responseTime,
          citations: result.results.perplexity.citations,
          realTimeData: result.results.perplexity.realTimeData,
          // Store both flattened data and reconstructed arrays for full detail
          citationsData: result.results.perplexity.citationsData,
          searchResultsData: result.results.perplexity.searchResultsData,
          structuredCitationsData: result.results.perplexity.structuredCitationsData,
          // Reconstruct arrays from flattened data for full storage
          citationsList: result.results.perplexity.citationsData ? 
            result.results.perplexity.citationsData.split('|||').filter(Boolean) : [],
          searchResults: result.results.perplexity.searchResultsData ? 
            result.results.perplexity.searchResultsData.split('###').filter(Boolean).map((r: string) => {
              const [title, url] = r.split('|||');
              return { title: title || '', url: url || '' };
            }) : [],
          structuredCitations: result.results.perplexity.structuredCitationsData ? 
            result.results.perplexity.structuredCitationsData.split('|||').filter(Boolean) : []
        });
      }
      
      batch.push(setDoc(docRef, detailedResult));
    }
    
    // Execute all writes
    await Promise.all(batch);
    
    return { success: true };
    
  } catch (error) {
    console.error('❌ Error saving detailed query results:', error);
    return { success: false, error };
  }
}

// Get detailed query results for a brand
export async function getDetailedQueryResults(
  brandId: string,
  limitCount: number = 100
): Promise<{ results: DetailedQueryResult[]; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8detailed_query_results'),
      where('brandId', '==', brandId),
      orderBy('date', 'desc'),
      limit(limitCount)
    );
    
    const querySnapshot = await getDocs(q);
    const results = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as DetailedQueryResult));
    
    return { results };
    
  } catch (error) {
    console.error('❌ Error fetching detailed query results:', error);
    return { results: [], error };
  }
}

// Get detailed query results for a specific processing session
export async function getDetailedQueryResultsBySession(
  processingSessionId: string
): Promise<{ results: DetailedQueryResult[]; error?: any }> {
  try {
    const q = query(
      collection(db, 'v8detailed_query_results'),
      where('processingSessionId', '==', processingSessionId),
      orderBy('date', 'desc')
    );
    
    const querySnapshot = await getDocs(q);
    const results = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as DetailedQueryResult));
    
    return { results };
    
  } catch (error) {
    console.error('❌ Error fetching detailed query results by session:', error);
    return { results: [], error };
  }
} 