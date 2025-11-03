import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, SEORequest } from './types';

export class SEOProvider extends BaseAPIProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig & { service: 'semrush' | 'ahrefs' | 'moz' }) {
    super(`seo-${config.service}`, 'seo', config);
    
    // Different API endpoints for different SEO services
    switch (config.service) {
      case 'semrush':
        this.baseUrl = 'https://api.semrush.com';
        break;
      case 'ahrefs':
        this.baseUrl = 'https://apiv2.ahrefs.com';
        break;
      case 'moz':
        this.baseUrl = 'https://lsapi.seomoz.com/v2';
        break;
      default:
        this.baseUrl = 'https://api.semrush.com';
    }
  }

  async execute(request: SEORequest & { type: 'domain-analysis' | 'keyword-research' | 'backlinks' }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `seo-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid SEO request format');
      }

      await this.checkRateLimit();

      const endpoint = this.getEndpoint(request.type);
      const params = this.buildParams(request);
      
      const url = `${this.baseUrl}${endpoint}?${params}`;
      
      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.config.apiKey}`,
          },
        });
      });

      const transformedData = this.transformResponse(rawResponse);
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost();

      return {
        providerId: this.name,
        requestId,
        status: 'success',
        data: transformedData,
        responseTime,
        cost,
        timestamp: new Date(),
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;
      
      return {
        providerId: this.name,
        requestId,
        status: 'error',
        error: (error as Error).message,
        responseTime,
        cost: 0,
        timestamp: new Date(),
      };
    }
  }

  validateRequest(request: SEORequest): boolean {
    return !!(request.url || request.keywords?.length);
  }

  transformResponse(rawResponse: any): any {
    // Transform based on the service and request type
    return {
      domain: rawResponse.domain,
      metrics: {
        organicKeywords: rawResponse.organic_keywords,
        organicTraffic: rawResponse.organic_traffic,
        organicCost: rawResponse.organic_cost,
        authorityScore: rawResponse.authority_score,
      },
      topKeywords: rawResponse.top_keywords || [],
      competitors: rawResponse.competitors || [],
      backlinks: rawResponse.backlinks || [],
    };
  }

  private getEndpoint(type: string): string {
    switch (type) {
      case 'domain-analysis':
        return '/domain_analytics';
      case 'keyword-research':
        return '/keyword_research';
      case 'backlinks':
        return '/backlinks';
      default:
        return '/domain_analytics';
    }
  }

  private buildParams(request: SEORequest): string {
    const params = new URLSearchParams();
    
    if (request.url) {
      params.append('target', request.url);
    }
    
    if (request.keywords?.length) {
      params.append('phrase', request.keywords.join(','));
    }
    
    if (request.location) {
      params.append('database', request.location);
    }
    
    params.append('limit', '50');
    
    return params.toString();
  }

  protected calculateCost(): number {
    // SEO API pricing (example)
    return 0.01; // $0.01 per request
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: SEORequest & { type: 'domain-analysis' } = {
        url: 'example.com',
        type: 'domain-analysis'
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 