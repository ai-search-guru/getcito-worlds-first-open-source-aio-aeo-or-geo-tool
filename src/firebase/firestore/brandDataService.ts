import firebase_app from "../config";
import { getFirestore, doc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { UserBrand } from './getUserBrands';

// Get the Firestore instance
const db = getFirestore(firebase_app);

export interface BrandDataStatus {
  hasMetrics: boolean;
  hasRecommendations: boolean;
  hasTopDomains: boolean;
  hasTrendData: boolean;
  hasBrandPrompts: boolean;
  hasLeaderboard: boolean;
  missingDataTypes: string[];
}

export async function checkBrandDataExists(userId: string, brandId: string): Promise<BrandDataStatus> {
  const status: BrandDataStatus = {
    hasMetrics: false,
    hasRecommendations: false,
    hasTopDomains: false,
    hasTrendData: false,
    hasBrandPrompts: false,
    hasLeaderboard: false,
    missingDataTypes: []
  };

  try {
    // Check for user metrics
    const metricsDoc = await getDoc(doc(db, 'user_metrics', userId));
    status.hasMetrics = metricsDoc.exists();

    // Check for user recommendations
    const recommendationsQuery = query(
      collection(db, 'user_recommendations'),
      where('userId', '==', userId),
      where('brandId', '==', brandId)
    );
    const recommendationsSnapshot = await getDocs(recommendationsQuery);
    status.hasRecommendations = !recommendationsSnapshot.empty;

    // Check for top domains
    const topDomainsQuery = query(
      collection(db, 'user_top_domains'),
      where('userId', '==', userId),
      where('brandId', '==', brandId)
    );
    const topDomainsSnapshot = await getDocs(topDomainsQuery);
    status.hasTopDomains = !topDomainsSnapshot.empty;

    // Check for trend data
    const trendQuery = query(
      collection(db, 'user_trends'),
      where('userId', '==', userId),
      where('brandId', '==', brandId)
    );
    const trendSnapshot = await getDocs(trendQuery);
    status.hasTrendData = !trendSnapshot.empty;

    // Check for brand prompts
    const brandPromptsQuery = query(
      collection(db, 'user_brand_prompts'),
      where('userId', '==', userId),
      where('brandId', '==', brandId)
    );
    const brandPromptsSnapshot = await getDocs(brandPromptsQuery);
    status.hasBrandPrompts = !brandPromptsSnapshot.empty;

    // Check for leaderboard data (global, but we check if it exists)
    const leaderboardSnapshot = await getDocs(collection(db, 'brand_leaderboard'));
    status.hasLeaderboard = !leaderboardSnapshot.empty;

    // Determine missing data types
    const dataTypes = [
      { key: 'hasMetrics', name: 'metrics' },
      { key: 'hasRecommendations', name: 'recommendations' },
      { key: 'hasTopDomains', name: 'topDomains' },
      { key: 'hasTrendData', name: 'trendData' },
      { key: 'hasBrandPrompts', name: 'brandPrompts' },
      { key: 'hasLeaderboard', name: 'leaderboard' }
    ];

    status.missingDataTypes = dataTypes
      .filter(type => !status[type.key as keyof BrandDataStatus])
      .map(type => type.name);

  } catch (error) {
    console.error('Error checking brand data:', error);
    // If there's an error, assume all data is missing
    status.missingDataTypes = ['metrics', 'recommendations', 'topDomains', 'trendData', 'brandPrompts', 'leaderboard'];
  }

  return status;
}

export async function getBrandInfo(brandId: string): Promise<UserBrand | null> {
  try {
    const brandDoc = await getDoc(doc(db, 'v8userbrands', brandId));
    if (brandDoc.exists()) {
      return {
        id: brandDoc.id,
        ...brandDoc.data()
      } as UserBrand;
    }
    return null;
  } catch (error) {
    console.error('Error fetching brand info:', error);
    return null;
  }
} 