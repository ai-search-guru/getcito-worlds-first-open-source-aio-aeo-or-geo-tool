import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, AzureOpenAISearchRequest } from './types';

export class AzureOpenAISearchProvider extends BaseAPIProvider {
  private azureEndpoint: string;
  private deploymentName: string;
  private apiVersion: string;
  private azureSearchEndpoint?: string;
  private azureSearchIndex?: string;
  private azureSearchApiKey?: string;
  private webSearchEnabled: boolean;

  constructor(config: ProviderConfig & {
    azureEndpoint: string;
    deploymentName: string;
    apiVersion?: string;
    azureSearchEndpoint?: string;
    azureSearchIndex?: string;
    azureSearchApiKey?: string;
  }) {
    super('azure-openai-search', 'ai', config);
    this.azureEndpoint = config.azureEndpoint;
    this.deploymentName = config.deploymentName;
    // Use stable API version for direct OpenAI calls (without Azure Search)
    this.apiVersion = config.apiVersion || '2024-08-01-preview';
    this.azureSearchEndpoint = config.azureSearchEndpoint;
    this.azureSearchIndex = config.azureSearchIndex;
    this.azureSearchApiKey = config.azureSearchApiKey;

    // DISABLED: Azure Search integration is now disabled
    // Always use direct Azure OpenAI endpoint without data sources
    this.webSearchEnabled = false;

    console.log('✅ Azure OpenAI provider initialized in DIRECT mode (Azure Search disabled)', {
      endpoint: this.azureEndpoint,
      deployment: this.deploymentName,
      apiVersion: this.apiVersion,
      mode: 'Direct Azure OpenAI without search integration'
    });
  }

  async execute(request: AzureOpenAISearchRequest): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `azure-openai-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      await this.checkRateLimit();

      const url = `${this.azureEndpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;

      // Build request body - DIRECT mode without Azure Search data sources
      const requestBody = {
        messages: request.messages,
        temperature: request.temperature || 0.7,
        max_tokens: request.max_tokens || 4000,
      };

      console.log('🚀 Sending direct Azure OpenAI request to:', url);
      console.log('📦 Request body:', JSON.stringify({
        messages: requestBody.messages,
        temperature: requestBody.temperature,
        max_tokens: requestBody.max_tokens,
        mode: 'Direct (no search integration)'
      }, null, 2));

      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'POST',
          headers: {
            'api-key': this.config.apiKey,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });
      });

      // Console log the complete raw response
      console.log('🔍 Azure OpenAI Direct Response:', JSON.stringify(rawResponse, null, 2));

      // Log specific parts for easier debugging
      console.log('🌐 Azure OpenAI Response Summary:', {
        model: rawResponse.model,
        hasContent: !!rawResponse.choices?.[0]?.message?.content,
        contentLength: rawResponse.choices?.[0]?.message?.content?.length || 0,
        contentPreview: rawResponse.choices?.[0]?.message?.content?.substring(0, 200) + '...',
        usage: rawResponse.usage,
        finishReason: rawResponse.choices?.[0]?.finish_reason
      });

      const transformedData = this.transformResponse(rawResponse);

      // Console log the transformed data
      console.log('✨ Azure OpenAI Transformed Data:', JSON.stringify(transformedData, null, 2));

      const responseTime = Date.now() - startTime;
      const cost = this.calculateCost(rawResponse.usage?.total_tokens);

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

      // Console log Azure OpenAI errors
      console.error('❌ Azure OpenAI Request Error:', {
        requestId,
        error: errorMessage,
        stack: (error as Error).stack,
        responseTime,
        endpoint: `${this.azureEndpoint}/openai/deployments/${this.deploymentName}/chat/completions`,
        request: JSON.stringify(request, null, 2)
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

  validateRequest(request: AzureOpenAISearchRequest): boolean {
    return !!(
      request.messages &&
      Array.isArray(request.messages) &&
      request.messages.length > 0 &&
      request.messages.every(msg => msg.role && msg.content)
    );
  }

  transformResponse(rawResponse: any): any {
    const message = rawResponse.choices?.[0]?.message;
    const content = message?.content || '';

    return {
      content: content,
      model: rawResponse.model || this.deploymentName,
      usage: rawResponse.usage,
      searchEnabled: false,
      webSearchUsed: false,
      tools: [],
      // No annotations in direct mode
      annotations: [],
      annotationsCount: 0,
      // Include metadata
      metadata: {
        hasAnnotations: false,
        hasCitations: false,
        responseId: rawResponse.id,
        created: rawResponse.created,
        object: rawResponse.object,
        finishReason: rawResponse.choices?.[0]?.finish_reason,
        webSearchConfigured: false,
        mode: 'direct',
      },
      // Raw response for debugging (optional)
      rawResponse: rawResponse
    };
  }

  protected calculateCost(tokensUsed: number = 0): number {
    // Azure OpenAI pricing for GPT-4 (example rates - adjust based on your deployment)
    const baseCostPer1K = 0.03;  // Input: $0.03 per 1K tokens
    const outputCostPer1K = 0.06; // Output: $0.06 per 1K tokens

    // Simplified calculation - in production you'd track input/output tokens separately
    return (tokensUsed / 1000) * ((baseCostPer1K + outputCostPer1K) / 2);
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: AzureOpenAISearchRequest = {
        messages: [
          { role: 'user', content: 'Hello, this is a health check.' }
        ],
        max_tokens: 10,
      };

      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
}
