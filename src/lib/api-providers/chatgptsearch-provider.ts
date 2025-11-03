import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, ChatGPTSearchRequest } from './types';
import OpenAI from 'openai';

export class ChatGPTSearchProvider extends BaseAPIProvider {
  private client: OpenAI;

  constructor(config: ProviderConfig) {
    super('chatgptsearch', 'ai', config);
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async execute(request: ChatGPTSearchRequest): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `chatgptsearch-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      await this.checkRateLimit();

      const response = await this.retryRequest(async () => {
        return await this.client.responses.create({
          model: request.model || "gpt-4.1",
          tools: [{ type: "web_search_preview" }],
          input: request.input,
          temperature: request.temperature,
          // Note: max_tokens might not be available in responses API
          // max_tokens: request.max_tokens,
        });
      });

      // Console log the complete raw response from ChatGPT Search
      console.log('🔍 ChatGPT Search Complete Raw Response:', JSON.stringify(response, null, 2));
      
      // Log specific parts for easier debugging
      console.log('🌐 ChatGPT Search Response Summary:', {
        model: response.model || 'gpt-4.1',
        hasOutput: !!response.output_text,
        outputLength: response.output_text?.length || 0,
        preview: response.output_text?.substring(0, 200) + '...',
        usage: response.usage,
        hasAnnotations: !!response.annotations,
        annotationsCount: response.annotations?.length || 0,
        annotationsPreview: response.annotations?.slice(0, 3) || []
      });

      const transformedData = this.transformResponse(response);
      
      // Console log the transformed data
      console.log('✨ ChatGPT Search Transformed Data:', JSON.stringify(transformedData, null, 2));
      
      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(response.usage?.total_tokens);

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
      
      // Console log ChatGPT Search errors
      console.error('❌ ChatGPT Search Request Error:', {
        requestId,
        error: (error as Error).message,
        stack: (error as Error).stack,
        responseTime,
        request: JSON.stringify(request, null, 2)
      });
      
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

  validateRequest(request: ChatGPTSearchRequest): boolean {
    return !!(
      request.input &&
      typeof request.input === 'string' &&
      request.input.trim().length > 0
    );
  }

  transformResponse(rawResponse: any): any {
    return {
      content: rawResponse.output_text || '',
      model: rawResponse.model || 'gpt-4.1',
      usage: rawResponse.usage,
      searchEnabled: true,
      webSearchUsed: true,
      tools: ['web_search_preview'],
      // Include annotations (sources, citations, etc.)
      annotations: rawResponse.annotations || [],
      annotationsCount: rawResponse.annotations?.length || 0,
      // Include any other metadata
      metadata: {
        hasAnnotations: !!rawResponse.annotations,
        responseId: rawResponse.id,
        created: rawResponse.created,
        object: rawResponse.object,
      },
      // Raw response for debugging (optional)
      rawResponse: rawResponse
    };
  }

  protected calculateCost(tokensUsed: number = 0): number {
    // ChatGPT Search pricing (with web search premium)
    const baseCostPer1K = 0.002;  // Base cost per 1K tokens
    const webSearchPremium = 0.001; // Additional cost for web search
    
    return (tokensUsed / 1000) * (baseCostPer1K + webSearchPremium);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: ChatGPTSearchRequest = {
        input: 'What is the current weather?',
        model: 'gpt-4.1',
        max_tokens: 50,
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 