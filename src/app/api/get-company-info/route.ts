import { NextRequest, NextResponse } from 'next/server';
import { ProviderManager } from '@/lib/api-providers/provider-manager';
import { APIRequest } from '@/lib/api-providers/types';
import { getDomainMetadata } from '@/lib/domain-metadata';
import { z } from 'zod';

// Input schema
const CompanyInfoInputSchema = z.object({
  domain: z.string().describe('The company domain name (e.g., "example.com" or "https://example.com").'),
});
type CompanyInfoInput = z.infer<typeof CompanyInfoInputSchema>;

// Output schema
const CompanyInfoSchema = z.object({
  companyName: z.string().describe('The official brand or company name'),
  shortDescription: z.string().describe('A concise 2-3 sentence summary of what the company does'),
  productsAndServices: z.array(z.string()).describe('List of main products, services, features, or offerings'),
  keywords: z.array(z.string()).describe('4-5 relevant keywords or phrases representing core business'),
  competitors: z.array(z.string()).describe('3-5 main competitor companies or brands in the same industry'),
  website: z.string().describe('Company website URL'),
});
type CompanyInfo = z.infer<typeof CompanyInfoSchema>;

function cleanDomain(domain: string): string {
  let cleanedDomain = domain.replace(/^https?:\/\//, '');
  cleanedDomain = cleanedDomain.replace(/^www\./, '');
  cleanedDomain = cleanedDomain.replace(/\/$/, '');
  return cleanedDomain;
}

function generateCompanyInfoPrompt(domain: string, websiteData?: { title?: string; description?: string; siteName?: string }): string {
  const hasWebsiteData = websiteData && (websiteData.title || websiteData.description);
  
  const contextSection = hasWebsiteData ? `

Website Data Retrieved:
- Title: ${websiteData.title || 'Not available'}
- Meta Description: ${websiteData.description || 'Not available'}
- Site Name: ${websiteData.siteName || 'Not available'}

Use this actual website data as your PRIMARY source of information.` : '';

  return `You are an AI assistant tasked with extracting structured company information from a given domain.

Input:  
Domain: ${domain}${contextSection}

Your Objective:  
${hasWebsiteData 
  ? 'Using the provided website data as your primary source, extract and structure the company information. Enhance this data with additional context if needed, but prioritize the actual website content provided above.'
  : 'Research the domain and relevant pages (e.g., homepage, /products, /services) and return the following structured information based only on verifiable evidence from the website or top-ranked search results. Avoid assumptions.'
}

Output Structure:
You MUST return a valid JSON object with all of the following fields. If you cannot find information for a specific field, return an empty string "" for text fields or an empty array [] for list fields. DO NOT omit any fields.

{
  "companyName": "Identify the official brand or company name",
  "shortDescription": "A concise 2 to 3 sentence summary describing what the company does",
  "productsAndServices": ["A", "bullet-point", "list", "of", "main", "products", "services", "features", "or", "offerings"],
  "keywords": ["4", "to", "5", "relevant", "keywords", "or", "phrases"],
  "competitors": ["3", "to", "5", "main", "competitor", "companies", "or", "brands"]
}

Instructions:
- Prioritize clarity, conciseness, and factual accuracy.
- ${hasWebsiteData ? 'Use the provided website data as your primary source and enhance it with logical inferences.' : 'Use top search results and the company\'s own site to gather data.'}
- For competitors: Identify companies that offer the SAME or SIMILAR products/services as listed. Include both direct competitors (same target market) and companies that provide alternative solutions to the same customer problems.
- Consider businesses that target the same customer segments, industries, or solve similar pain points.
- Do NOT infer or speculate beyond what is clearly stated in the source content.
- Return ONLY the JSON object, no additional text or formatting.
- Ensure the JSON is valid and properly formatted.`;
}

function parseAIResponse(response: string, domain: string): CompanyInfo {
  try {
    // Clean the response to extract JSON
    let cleanedResponse = response.trim();
    
    // Remove markdown code blocks if present
    if (cleanedResponse.startsWith('```json')) {
      cleanedResponse = cleanedResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
    } else if (cleanedResponse.startsWith('```')) {
      cleanedResponse = cleanedResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    
    const parsed = JSON.parse(cleanedResponse);
    
    // Validate and structure the response
    const result: CompanyInfo = {
      companyName: parsed.companyName || domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
      shortDescription: parsed.shortDescription || `A company operating at ${domain}`,
      productsAndServices: Array.isArray(parsed.productsAndServices) ? parsed.productsAndServices : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      competitors: Array.isArray(parsed.competitors) ? parsed.competitors : [],
      website: `https://www.${domain}`,
    };
    
    return result;
  } catch (error) {
    console.error('Error parsing AI response:', error);
    console.error('Raw response:', response);
    
    // Return fallback structure if parsing fails
    return {
      companyName: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
      shortDescription: `A company operating at ${domain}. Unable to fetch detailed information.`,
      productsAndServices: [],
      keywords: [],
      competitors: [],
      website: `https://www.${domain}`,
    };
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as CompanyInfoInput;
    
    if (!body.domain) {
      return NextResponse.json(
        { success: false, error: 'Domain is required' },
        { status: 400 }
      );
    }

    const domain = cleanDomain(body.domain);
    
    console.log('🚀 Starting company info fetch for domain:', domain);
    
    // Step 1: Fetch actual website metadata first
    console.log('📄 Fetching website metadata...');
    let websiteMetadata = null;
    try {
      websiteMetadata = await getDomainMetadata({ domain });
      console.log('✅ Website metadata fetched:', {
        title: websiteMetadata.title,
        description: websiteMetadata.description?.substring(0, 100) + '...',
        siteName: websiteMetadata.siteName
      });
    } catch (error) {
      console.warn('⚠️ Could not fetch website metadata, proceeding without it:', error);
    }
    
    // Step 2: Generate enhanced prompt with website data
    const prompt = generateCompanyInfoPrompt(domain, websiteMetadata || undefined);
    
    // Initialize provider manager
    const providerManager = new ProviderManager();
    
    // Create API request with Azure AD as primary, Gemini as fallback
    const apiRequest: APIRequest = {
      id: `company-info-${Date.now()}`,
      prompt: prompt,
      providers: ['azure-openai', 'google-gemini'], // Azure AD first, then Gemini fallback
      priority: 'medium',
      userId: 'system', // Using system for non-authenticated requests
      createdAt: new Date(),
      metadata: {
        domain: domain,
        type: 'company-info',
      }
    };

    console.log('🔄 Executing request with providers:', apiRequest.providers);
    
    // Execute the request
    const result = await providerManager.executeRequest(apiRequest);
    
    console.log('📊 Provider results:', {
      totalResults: result.results.length,
      successfulResults: result.results.filter(r => r.status === 'success').length,
      totalCost: result.totalCost
    });

    // Try to get successful response in priority order
    const successfulResults = result.results.filter(r => r.status === 'success');
    
    if (successfulResults.length === 0) {
      console.error('❌ All providers failed');
      throw new Error('All AI providers failed to analyze the domain');
    }

    // Use the first successful result (Azure AD has priority)
    const primaryResult = successfulResults[0];
    console.log('✅ Using result from provider:', primaryResult.providerId);
    
    if (!primaryResult.data?.content) {
      throw new Error('No content received from AI provider');
    }

    // Parse the AI response
    const companyInfo = parseAIResponse(primaryResult.data.content, domain);
    
    console.log('✅ Company info extracted:', {
      companyName: companyInfo.companyName,
      description: companyInfo.shortDescription?.substring(0, 100) + '...',
      productsCount: companyInfo.productsAndServices?.length || 0,
      keywordsCount: companyInfo.keywords?.length || 0,
    });
    
    return NextResponse.json({
      success: true,
      data: companyInfo,
      metadata: {
        timestamp: new Date().toISOString(),
        source: primaryResult.providerId,
        responseTime: primaryResult.responseTime,
        cost: primaryResult.cost,
        websiteMetadata: websiteMetadata ? {
          title: websiteMetadata.title,
          description: websiteMetadata.description,
          siteName: websiteMetadata.siteName,
          hasRealData: true
        } : { hasRealData: false },
        providersUsed: result.results.map(r => ({
          provider: r.providerId,
          status: r.status,
          responseTime: r.responseTime
        }))
      }
    });

  } catch (error) {
    console.error('❌ Company info API error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
} 