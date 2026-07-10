import firebase_app from "../config";
import { getFirestore, collection, doc, getDoc, getDocs, query, where, orderBy, limit } from "firebase/firestore";

// Get the Firestore instance
const db = getFirestore(firebase_app);

// Types for dashboard data
export interface MetricData {
  title: string;
  value: string;
  change: number;
  changeLabel: string;
  color: 'green' | 'blue' | 'yellow' | 'red';
  description: string;
}

export interface LeaderboardEntry {
  rank: number;
  brand: string;
  domain?: string; // Added for WebLogo
  mentions: number;
  visibility: number;
  change: number;
  sentiment: 'positive' | 'negative' | 'neutral';
}

export interface RecommendationData {
  id: string;
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  category: string;
  imageUrl: string;
  readTime: string;
  rating: number;
}

export interface TopDomainData {
  rank: number;
  domain: string;
  mentions: number;
  progress: number;
  icon: string;
}

export interface TrendData {
  date: string;
  brandMentions: number;
  sentiment: number;
  visibility: number;
}

// Fetch user-specific metrics for a brand
export async function getUserMetrics(userId: string, brandId?: string): Promise<{ result: MetricData[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    if (brandId) {
      // Fetch brand-specific metrics from v8userbrands collection
      console.log('📊 Fetching metrics for brand:', brandId);
      const docRef = doc(db, 'v8userbrands', brandId);
      const docSnap = await getDoc(docRef);
      
      if (docSnap.exists()) {
        const brandData = docSnap.data();
        console.log('📋 Brand document found:', {
          hasBasicData: !!brandData.brandsbasicData,
          companyName: brandData.companyName,
          docId: brandId
        });
        const analytics = brandData.brandsbasicData;
        
        if (analytics) {
          console.log('✅ Brand analytics data:', analytics);
          result = [
            {
              title: "Brand Validity",
              value: `${analytics.brandValidity || 0}%`,
              change: analytics.brandValidityChange || 0,
              changeLabel: "vs last month",
              color: "green" as const,
              description: "Accuracy of brand mentions"
            },
            {
              title: "Link Validity",
              value: `${analytics.linkValidity || 0}%`,
              change: analytics.linkValidityChange || 0,
              changeLabel: "vs last month",
              color: "blue" as const,
              description: "Valid reference links"
            },
            {
              title: "Brand Mentions",
              value: analytics.brandMentions?.toLocaleString() || "0",
              change: analytics.brandMentionsChange || 0,
              changeLabel: "vs last month",
              color: "yellow" as const,
              description: "Total mentions tracked"
            },
            {
              title: "Sentiment Analysis",
              value: `${analytics.sentimentScore || 0}/10`,
              change: analytics.sentimentChange || 0,
              changeLabel: "vs last month",
              color: analytics.sentimentScore >= 8 ? "green" as const : analytics.sentimentScore >= 6 ? "yellow" as const : "red" as const,
              description: "Average sentiment score"
            }
          ];
        } else {
          console.log('⚠️ No brandsbasicData found in brand document');
        }
      } else {
        console.log('❌ Brand document not found for ID:', brandId);
      }
    } else {
      // For user-level metrics (when no specific brand is selected), 
      // we can try to fetch from user_metrics collection or return empty
      const docRef = doc(db, `user_metrics/${userId}`);
    const docSnap = await getDoc(docRef);
    
    if (docSnap.exists()) {
      const data = docSnap.data();
      result = [
        {
          title: "Brand Validity",
          value: `${data.brandValidity || 0}%`,
          change: data.brandValidityChange || 0,
          changeLabel: "vs last month",
          color: "green" as const,
          description: "Accuracy of brand mentions"
        },
        {
          title: "Link Validity",
          value: `${data.linkValidity || 0}%`,
          change: data.linkValidityChange || 0,
          changeLabel: "vs last month",
          color: "blue" as const,
          description: "Valid reference links"
        },
        {
          title: "Brand Mentions",
          value: data.brandMentions?.toLocaleString() || "0",
          change: data.brandMentionsChange || 0,
          changeLabel: "vs last month",
          color: "yellow" as const,
          description: "Total mentions tracked"
        },
        {
          title: "Sentiment Analysis",
          value: `${data.sentimentScore || 0}/10`,
          change: data.sentimentChange || 0,
          changeLabel: "vs last month",
          color: "green" as const,
          description: "Average sentiment score"
        }
      ];
      }
    }
  } catch (e) {
    console.error('Error fetching user metrics:', e);
    error = e;
  }

  return { result, error };
}

// Fetch leaderboard data
export async function getLeaderboardData(): Promise<{ result: LeaderboardEntry[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    const q = query(
      collection(db, 'brand_leaderboard'),
      orderBy('mentions', 'desc'),
      limit(10)
    );
    const querySnapshot = await getDocs(q);
    
    result = querySnapshot.docs.map((doc, index) => ({
      rank: index + 1,
      brand: doc.data().brand,
      mentions: doc.data().mentions,
      visibility: doc.data().visibility,
      change: doc.data().change,
      sentiment: doc.data().sentiment
    }));
  } catch (e) {
    error = e;
  }

  return { result, error };
}

// Fetch user-specific recommendations for a brand
export async function getUserRecommendations(userId: string, brandId?: string): Promise<{ result: RecommendationData[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    let q;
    if (brandId) {
      // Fetch brand-specific recommendations
      q = query(
        collection(db, 'user_recommendations'),
        where('userId', '==', userId),
        where('brandId', '==', brandId),
        orderBy('priority', 'desc'),
        limit(5)
      );
    } else {
      // Fetch general user recommendations
      q = query(
      collection(db, 'user_recommendations'),
      where('userId', '==', userId),
      orderBy('priority', 'desc'),
      limit(5)
    );
    }
    
    const querySnapshot = await getDocs(q);
    
    result = querySnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as RecommendationData));
  } catch (e) {
    error = e;
  }

  return { result, error };
}

// Fetch top domains for user and brand
export async function getUserTopDomains(userId: string, brandId?: string): Promise<{ result: TopDomainData[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    let q;
    if (brandId) {
      // Fetch brand-specific top domains
      q = query(
        collection(db, 'user_top_domains'),
        where('userId', '==', userId),
        where('brandId', '==', brandId),
        orderBy('mentions', 'desc'),
        limit(8)
      );
    } else {
      // Fetch user-level top domains
      q = query(
      collection(db, 'user_top_domains'),
      where('userId', '==', userId),
      orderBy('mentions', 'desc'),
      limit(8)
    );
    }
    
    const querySnapshot = await getDocs(q);
    
    result = querySnapshot.docs.map((doc, index) => ({
      rank: index + 1,
      domain: doc.data().domain,
      mentions: doc.data().mentions,
      progress: doc.data().progress,
      icon: doc.data().icon
    }));
  } catch (e) {
    error = e;
  }

  return { result, error };
}

// Fetch trend data for charts
export async function getUserTrendData(userId: string, brandId?: string, days: number = 30): Promise<{ result: TrendData[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    let q;
    if (brandId) {
      // Fetch brand-specific trend data
      q = query(
        collection(db, 'user_trends'),
        where('userId', '==', userId),
        where('brandId', '==', brandId),
        orderBy('date', 'desc'),
        limit(days)
      );
    } else {
      // Fetch user-level trend data
      q = query(
      collection(db, 'user_trends'),
      where('userId', '==', userId),
      orderBy('date', 'desc'),
      limit(days)
    );
    }
    
    const querySnapshot = await getDocs(q);
    
    result = querySnapshot.docs.map(doc => ({
      date: doc.data().date,
      brandMentions: doc.data().brandMentions,
      sentiment: doc.data().sentiment,
      visibility: doc.data().visibility
    })).reverse(); // Reverse to get chronological order
  } catch (e) {
    error = e;
  }

  return { result, error };
}

// Fetch brand prompts analysis
export async function getBrandPromptsData(userId: string, brandId?: string): Promise<{ result: LeaderboardEntry[] | null; error: any }> {
  let result = null;
  let error = null;

  try {
    let q;
    if (brandId) {
      // Fetch brand-specific prompts analysis
      q = query(
        collection(db, 'user_brand_prompts'),
        where('userId', '==', userId),
        where('brandId', '==', brandId),
        orderBy('mentions', 'desc'),
        limit(6)
      );
    } else {
      // Fetch user-level prompts analysis
      q = query(
      collection(db, 'user_brand_prompts'),
      where('userId', '==', userId),
      orderBy('mentions', 'desc'),
      limit(6)
    );
    }
    
    const querySnapshot = await getDocs(q);
    
    result = querySnapshot.docs.map((doc, index) => ({
      rank: index + 1,
      brand: doc.data().promptType,
      mentions: doc.data().mentions,
      visibility: doc.data().visibility,
      change: doc.data().change,
      sentiment: doc.data().sentiment
    }));
  } catch (e) {
    error = e;
  }

  return { result, error };
} 