import { APIResponse, ProviderConfig } from './types';

export abstract class BaseAPIProvider {
  protected config: ProviderConfig;
  protected name: string;
  protected type: 'ai' | 'seo' | 'data' | 'analytics';

  constructor(name: string, type: 'ai' | 'seo' | 'data' | 'analytics', config: ProviderConfig) {
    this.name = name;
    this.type = type;
    this.config = config;
  }

  // Abstract methods that each provider must implement
  abstract execute(request: any): Promise<APIResponse>;
  abstract validateRequest(request: any): boolean;
  abstract transformResponse(rawResponse: any): any;

  // Common methods available to all providers
  protected async makeRequest(url: string, options: RequestInit): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...this.config.customHeaders,
          ...options.headers,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        // Try to get detailed error message from response body
        let errorDetails = response.statusText;
        try {
          const errorBody = await response.text();
          if (errorBody) {
            try {
              const errorJson = JSON.parse(errorBody);
              errorDetails = errorJson.error?.message || errorJson.message || errorBody;
            } catch {
              errorDetails = errorBody.substring(0, 500); // Limit error message length
            }
          }
        } catch (e) {
          // If we can't read the body, just use statusText
        }
        throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorDetails}`);
      }

      return await response.json();
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  protected async retryRequest(
    requestFn: () => Promise<any>,
    maxRetries: number = this.config.retryAttempts
  ): Promise<any> {
    let lastError: Error;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await requestFn();
      } catch (error) {
        lastError = error as Error;
        
        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = Math.pow(2, attempt) * 1000;
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError!;
  }

  // Rate limiting check (to be implemented with Redis in production)
  protected async checkRateLimit(): Promise<boolean> {
    // TODO: Implement Redis-based rate limiting
    return true;
  }

  // Cost calculation
  protected calculateCost(tokensUsed?: number): number {
    // Base cost calculation - can be overridden by specific providers
    return 0.001; // Default minimal cost
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      // Each provider can override this for specific health checks
      return true;
    } catch {
      return false;
    }
  }

  // Getters
  getName(): string {
    return this.name;
  }

  getType(): string {
    return this.type;
  }
} 