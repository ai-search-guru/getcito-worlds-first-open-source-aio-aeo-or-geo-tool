import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, GeminiRequest } from './types';

export class GeminiProvider extends BaseAPIProvider {
  private baseUrl: string;

  constructor(config: ProviderConfig) {
    super('google-gemini', 'ai', config);
    this.baseUrl = config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta';
  }

  async execute(request: GeminiRequest & { model?: string }): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `gemini-${Date.now()}`;

    try {
      if (!this.config.apiKey || this.config.apiKey.trim() === '') {
        throw new Error('Google AI API key is not configured');
      }

      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      await this.checkRateLimit();

      const model = request.model || 'gemini-2.0-flash-thinking-exp';
      const url = `${this.baseUrl}/models/${model}:generateContent?key=${this.config.apiKey}`;
      
      console.log(`🚀 Gemini API Request:`, {
        url: url.replace(this.config.apiKey, '[API_KEY]'),
        model,
        contentsLength: request.contents?.length
      });
      
      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'POST',
          body: JSON.stringify({
            contents: request.contents,
            generationConfig: request.generationConfig,
          }),
        });
      });

      console.log(`✅ Gemini API Response received:`, {
        hasCandidates: !!rawResponse.candidates,
        candidatesLength: rawResponse.candidates?.length
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
      const errorMessage = (error as Error).message;
      
      console.error(`❌ Gemini API Error:`, {
        error: errorMessage,
        responseTime,
        apiKeyConfigured: !!this.config.apiKey && this.config.apiKey.trim() !== ''
      });
      
      return {
        providerId: this.name,
        requestId,
        status: 'error',
        error: errorMessage,
        responseTime,
        cost: 0,
        timestamp: new Date(),
      };
    }
  }

  validateRequest(request: GeminiRequest): boolean {
    return !!(
      request.contents &&
      Array.isArray(request.contents) &&
      request.contents.length > 0 &&
      request.contents[0].parts &&
      Array.isArray(request.contents[0].parts)
    );
  }

  transformResponse(rawResponse: any): any {
    const candidate = rawResponse.candidates?.[0];
    return {
      content: candidate?.content?.parts?.[0]?.text || '',
      finishReason: candidate?.finishReason,
      safetyRatings: candidate?.safetyRatings,
      citationMetadata: candidate?.citationMetadata,
    };
  }

  protected calculateCost(): number {
    // Gemini Pro pricing (example)
    return 0.0005; // $0.0005 per request (simplified)
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: GeminiRequest = {
        contents: [{
          parts: [{ text: 'Hello' }]
        }]
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 