import { z } from 'zod';

// Types for domain metadata
export const DomainMetadataSchema = z.object({
  title: z.string().describe('Website title'),
  description: z.string().describe('Meta description'),
  image: z.string().optional().describe('Open Graph image URL'),
  siteName: z.string().optional().describe('Site name from Open Graph'),
  url: z.string().describe('Canonical URL'),
});

export type DomainMetadata = z.infer<typeof DomainMetadataSchema>;

export interface DomainMetadataInput {
  domain: string;
}

function cleanDomain(domain: string): string {
  let cleanedDomain = domain.replace(/^https?:\/\//, '');
  cleanedDomain = cleanedDomain.replace(/^www\./, '');
  cleanedDomain = cleanedDomain.replace(/\/$/, '');
  return cleanedDomain;
}

function extractMetaTags(html: string): Partial<DomainMetadata> {
  const metadata: Partial<DomainMetadata> = {};

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) {
    metadata.title = titleMatch[1].trim();
  }

  // Extract meta description
  const descriptionMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (descriptionMatch) {
    metadata.description = descriptionMatch[1].trim();
  }

  // Extract Open Graph title (fallback for title)
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogTitleMatch && !metadata.title) {
    metadata.title = ogTitleMatch[1].trim();
  }

  // Extract Open Graph description (fallback for description)
  const ogDescriptionMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogDescriptionMatch && !metadata.description) {
    metadata.description = ogDescriptionMatch[1].trim();
  }

  // Extract Open Graph image
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogImageMatch) {
    metadata.image = ogImageMatch[1].trim();
  }

  // Extract Open Graph site name
  const ogSiteNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  if (ogSiteNameMatch) {
    metadata.siteName = ogSiteNameMatch[1].trim();
  }

  return metadata;
}

export async function getDomainMetadata(input: DomainMetadataInput): Promise<DomainMetadata> {
  const cleanedDomain = cleanDomain(input.domain);
  const url = `https://${cleanedDomain}`;

  try {
    console.log(`🔍 Fetching metadata for: ${url}`);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; AI-Monitor-Bot/1.0)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive',
      },
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const html = await response.text();
    const metadata = extractMetaTags(html);

    // Ensure we have at least basic metadata
    const result: DomainMetadata = {
      title: metadata.title || cleanedDomain.split('.')[0].charAt(0).toUpperCase() + cleanedDomain.split('.')[0].slice(1),
      description: metadata.description || `Website for ${cleanedDomain}`,
      image: metadata.image,
      siteName: metadata.siteName,
      url: url,
    };

    console.log(`✅ Metadata extracted:`, {
      title: result.title.substring(0, 50) + '...',
      description: result.description.substring(0, 100) + '...',
      hasImage: !!result.image,
      siteName: result.siteName
    });

    return result;

  } catch (error) {
    console.error(`❌ Failed to fetch metadata for ${url}:`, error);
    
    // Return fallback metadata
    return {
      title: cleanedDomain.split('.')[0].charAt(0).toUpperCase() + cleanedDomain.split('.')[0].slice(1),
      description: `Website for ${cleanedDomain}`,
      url: url,
    };
  }
} 