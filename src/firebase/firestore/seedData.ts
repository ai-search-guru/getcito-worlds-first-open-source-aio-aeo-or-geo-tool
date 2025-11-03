import firebase_app from "../config";
import { getFirestore, collection, doc, setDoc, writeBatch } from "firebase/firestore";

const db = getFirestore(firebase_app);

// Sample data for seeding
const sampleUserMetrics = {
  brandValidity: 94.2,
  brandValidityChange: 5.3,
  linkValidity: 87.8,
  linkValidityChange: -2.1,
  brandMentions: 1247,
  brandMentionsChange: 12.5,
  sentimentScore: 8.6,
  sentimentChange: 0.8,
  lastUpdated: new Date().toISOString()
};

const sampleLeaderboardData = [
  { brand: "OpenAI", domain: "openai.com", mentions: 15420, visibility: 94, change: 12.3, sentiment: "positive" },
  { brand: "Google", domain: "google.com", mentions: 12890, visibility: 87, change: 8.7, sentiment: "positive" },
  { brand: "Microsoft", domain: "microsoft.com", mentions: 11200, visibility: 82, change: -2.1, sentiment: "neutral" },
  { brand: "Anthropic", domain: "anthropic.com", mentions: 8950, visibility: 76, change: 15.4, sentiment: "positive" },
  { brand: "Meta", domain: "meta.com", mentions: 7650, visibility: 71, change: -5.3, sentiment: "negative" },
  { brand: "Apple", domain: "apple.com", mentions: 6420, visibility: 68, change: 3.2, sentiment: "positive" }
];

const sampleRecommendations = [
  {
    title: "Optimize brand mentions in ChatGPT responses",
    description: "Increase your brand visibility by 23% through strategic content optimization and keyword targeting.",
    priority: "high",
    category: "Content Strategy",
    imageUrl: "https://picsum.photos/400/300?random=10",
    readTime: "5 min read",
    rating: 4.8
  },
  {
    title: "Improve sentiment analysis on Perplexity",
    description: "Address negative sentiment patterns detected in recent brand mentions to improve overall rating.",
    priority: "medium",
    category: "Reputation Management",
    imageUrl: "https://picsum.photos/400/300?random=11",
    readTime: "3 min read",
    rating: 4.2
  },
  {
    title: "Expand competitor analysis coverage",
    description: "Track 12 additional competitors to get more comprehensive market intelligence.",
    priority: "low",
    category: "Market Intelligence",
    imageUrl: "https://picsum.photos/400/300?random=12",
    readTime: "7 min read",
    rating: 4.5
  }
];

const sampleTopDomains = [
  { domain: "www.zeni.ai", mentions: 6, progress: 90, icon: "⚡" },
  { domain: "mercury.com", mentions: 5, progress: 75, icon: "▪️" },
  { domain: "affoweb.com", mentions: 4, progress: 60, icon: "🔺" },
  { domain: "kruzeconsulting.com", mentions: 4, progress: 85, icon: "📊" },
  { domain: "topapps.ai", mentions: 3, progress: 50, icon: "⚫" },
  { domain: "www.codemasters.ai", mentions: 3, progress: 45, icon: "⚪" },
  { domain: "www.freshbooks.com", mentions: 3, progress: 65, icon: "🔷" },
  { domain: "www.phoenixstrategy.com", mentions: 3, progress: 70, icon: "🔶" }
];

const sampleBrandPrompts = [
  { brand: "ChatGPT Integration", domain: "chat.openai.com", mentions: 892, visibility: 89, change: 24.1, sentiment: "positive" },
  { brand: "AI Assistant Features", domain: "assistant.google.com", mentions: 745, visibility: 82, change: 18.7, sentiment: "positive" },
  { brand: "Machine Learning APIs", domain: "cloud.google.com", mentions: 634, visibility: 76, change: -3.2, sentiment: "neutral" },
  { brand: "Natural Language Processing", domain: "huggingface.co", mentions: 521, visibility: 71, change: 9.8, sentiment: "positive" },
  { brand: "Deep Learning Models", domain: "pytorch.org", mentions: 456, visibility: 65, change: 7.2, sentiment: "positive" },
  { brand: "Neural Networks", domain: "tensorflow.org", mentions: 389, visibility: 58, change: -1.5, sentiment: "neutral" }
];

// Generate trend data for the last 30 days
const generateTrendData = () => {
  const data = [];
  const now = new Date();
  
  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    
    data.push({
      date: date.toISOString().split('T')[0],
      brandMentions: Math.floor(Math.random() * 100) + 50,
      sentiment: Math.round((Math.random() * 4 + 6) * 10) / 10, // 6.0 - 10.0
      visibility: Math.floor(Math.random() * 30) + 70 // 70-100
    });
  }
  
  return data;
};

// Seed user-specific data
export async function seedUserData(userId: string): Promise<{ success: boolean; error?: any }> {
  try {
    const batch = writeBatch(db);

    // Add user metrics
    const userMetricsRef = doc(db, 'user_metrics', userId);
    batch.set(userMetricsRef, sampleUserMetrics);

    // Add user recommendations
    sampleRecommendations.forEach((rec, index) => {
      const recRef = doc(collection(db, 'user_recommendations'));
      batch.set(recRef, {
        ...rec,
        userId,
        createdAt: new Date().toISOString()
      });
    });

    // Add user top domains
    sampleTopDomains.forEach((domain, index) => {
      const domainRef = doc(collection(db, 'user_top_domains'));
      batch.set(domainRef, {
        ...domain,
        userId,
        lastUpdated: new Date().toISOString()
      });
    });

    // Add user brand prompts
    sampleBrandPrompts.forEach((prompt, index) => {
      const promptRef = doc(collection(db, 'user_brand_prompts'));
      batch.set(promptRef, {
        ...prompt,
        promptType: prompt.brand, // Keep backward compatibility
        userId,
        lastUpdated: new Date().toISOString()
      });
    });

    // Add trend data
    const trendData = generateTrendData();
    trendData.forEach((trend) => {
      const trendRef = doc(collection(db, 'user_trends'));
      batch.set(trendRef, {
        ...trend,
        userId,
        createdAt: new Date().toISOString()
      });
    });

    await batch.commit();
    console.log('User data seeded successfully for user:', userId);
    return { success: true };

  } catch (error) {
    console.error('Error seeding user data:', error);
    return { success: false, error };
  }
}

// Seed global leaderboard data
export async function seedGlobalData(): Promise<{ success: boolean; error?: any }> {
  try {
    const batch = writeBatch(db);

    // Add leaderboard data
    sampleLeaderboardData.forEach((entry, index) => {
      const leaderboardRef = doc(collection(db, 'brand_leaderboard'));
      batch.set(leaderboardRef, {
        ...entry,
        lastUpdated: new Date().toISOString()
      });
    });

    await batch.commit();
    console.log('Global data seeded successfully');
    return { success: true };

  } catch (error) {
    console.error('Error seeding global data:', error);
    return { success: false, error };
  }
}

// Convenience function to seed all data
export async function seedAllData(userId: string): Promise<{ success: boolean; error?: any }> {
  try {
    await seedGlobalData();
    await seedUserData(userId);
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
} 