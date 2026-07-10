import { NextRequest, NextResponse } from 'next/server';
import addData from '@/firebase/firestore/addData';

interface BrandBasicData {
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

interface CompleteBrandData {
  // Existing brand data
  companyName: string;
  domain: string;
  shortDescription: string;
  productsAndServices: string[];
  keywords: string[];
  website: string;
  userId: string;
  createdAt: string;
  
  // New analytics data
  brandsbasicData: BrandBasicData;
}

function generateRealisticAnalytics(companyName: string, domain: string, keywords: string[]): BrandBasicData {
  // Generate realistic ranges based on company characteristics
  const companySize = estimateCompanySize(companyName, domain, keywords);
  const industryFactor = getIndustryFactor(keywords);
  
  // Brand Mentions (0-902 range as specified)
  let baseMentions: number;
  if (companySize === 'large') {
    baseMentions = Math.floor(Math.random() * 400) + 500; // 500-900
  } else if (companySize === 'medium') {
    baseMentions = Math.floor(Math.random() * 300) + 200; // 200-500
  } else {
    baseMentions = Math.floor(Math.random() * 200) + 10; // 10-200
  }
  
  const brandMentions = Math.min(902, Math.floor(baseMentions * industryFactor));
  
  // Brand Mentions Change (-130 to 43 range as specified)
  const brandMentionsChange = parseFloat((Math.random() * 173 - 130).toFixed(1)); // -130 to 43
  
  // Brand Validity (70-99 range for realistic scores)
  const brandValidity = parseFloat((Math.random() * 29 + 70).toFixed(1)); // 70.0 - 99.0
  
  // Brand Validity Change (-10 to 15 range)
  const brandValidityChange = parseFloat((Math.random() * 25 - 10).toFixed(1)); // -10.0 to 15.0
  
  // Link Validity (60-95 range for realistic scores)
  const linkValidity = parseFloat((Math.random() * 35 + 60).toFixed(1)); // 60.0 - 95.0
  
  // Link Validity Change (-10 to 10 range)
  const linkValidityChange = parseFloat((Math.random() * 20 - 10).toFixed(1)); // -10.0 to 10.0
  
  // Sentiment Score (6-10 range for positive brands)
  const sentimentScore = parseFloat((Math.random() * 4 + 6).toFixed(1)); // 6.0 - 10.0
  
  // Sentiment Change (-2 to 3 range)
  const sentimentChange = parseFloat((Math.random() * 5 - 2).toFixed(1)); // -2.0 to 3.0
  
  return {
    brandMentions,
    brandMentionsChange,
    brandValidity,
    brandValidityChange,
    lastUpdated: new Date().toISOString(),
    linkValidity,
    linkValidityChange,
    sentimentChange,
    sentimentScore
  };
}

function estimateCompanySize(companyName: string, domain: string, keywords: string[]): 'small' | 'medium' | 'large' {
  const largeTech = ['microsoft', 'google', 'apple', 'amazon', 'meta', 'facebook', 'netflix', 'tesla', 'openai'];
  const mediumTech = ['startup', 'saas', 'platform', 'enterprise', 'solutions', 'technologies'];
  
  const companyLower = companyName.toLowerCase();
  const domainLower = domain.toLowerCase();
  const keywordsLower = keywords.map(k => k.toLowerCase()).join(' ');
  
  // Check for large companies
  if (largeTech.some(tech => companyLower.includes(tech) || domainLower.includes(tech))) {
    return 'large';
  }
  
  // Check for medium companies
  if (mediumTech.some(tech => companyLower.includes(tech) || keywordsLower.includes(tech))) {
    return 'medium';
  }
  
  return 'small';
}

function getIndustryFactor(keywords: string[]): number {
  const keywordsStr = keywords.join(' ').toLowerCase();
  
  // High-visibility industries
  if (keywordsStr.includes('ai') || keywordsStr.includes('artificial intelligence') || 
      keywordsStr.includes('machine learning') || keywordsStr.includes('technology')) {
    return 1.3; // 30% boost for AI/Tech
  }
  
  // Medium-visibility industries
  if (keywordsStr.includes('saas') || keywordsStr.includes('software') || 
      keywordsStr.includes('platform') || keywordsStr.includes('marketing')) {
    return 1.1; // 10% boost
  }
  
  // Standard industries
  return 1.0;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('🚀 Generate Brand Data API Request:', {
      companyName: body.companyName,
      domain: body.domain,
      userId: body.userId,
      timestamp: new Date().toISOString()
    });

    // Validate required fields
    const requiredFields = ['companyName', 'domain', 'shortDescription', 'userId'];
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { success: false, error: `${field} is required` },
          { status: 400 }
        );
      }
    }

    const {
      companyName,
      domain,
      shortDescription,
      productsAndServices = [],
      keywords = [],
      website,
      userId
    } = body;

    console.log('📊 Generating brand analytics data...');
    
    // Generate realistic brand analytics
    const brandsbasicData = generateRealisticAnalytics(companyName, domain, keywords);
    
    console.log('✅ Generated analytics:', {
      brandMentions: brandsbasicData.brandMentions,
      brandValidity: brandsbasicData.brandValidity,
      sentimentScore: brandsbasicData.sentimentScore,
      linkValidity: brandsbasicData.linkValidity
    });

    // Prepare complete brand data
    const completeBrandData: CompleteBrandData = {
      companyName,
      domain,
      shortDescription,
      productsAndServices,
      keywords,
      website: website || `https://www.${domain}`,
      userId,
      createdAt: new Date().toISOString(),
      brandsbasicData
    };

    // Generate user-scoped document ID to prevent conflicts
    const cleanDomain = domain.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const brandId = `${userId}_${cleanDomain}`;
    
    console.log('💾 Storing brand data in Firestore with ID:', brandId);
    
    // Store in Firestore
    const { result, error } = await addData('v8userbrands', brandId, completeBrandData);
    
    if (error) {
      console.error('❌ Firestore error:', error);
      throw new Error('Failed to store brand data');
    }
    
    console.log('✅ Brand data stored successfully');

    return NextResponse.json({
      success: true,
      data: {
        brandId,
        brandsbasicData,
        message: 'Brand setup completed successfully'
      },
      metadata: {
        timestamp: new Date().toISOString(),
        documentId: brandId,
        collectionName: 'v8userbrands'
      }
    });

  } catch (error) {
    console.error('❌ Generate Brand Data API error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
} 