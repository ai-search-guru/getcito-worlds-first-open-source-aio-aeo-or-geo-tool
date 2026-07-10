import { BaseAPIProvider } from './base-provider';
import { APIResponse, ProviderConfig, OpenAIRequest } from './types';
import OpenAI from 'openai';

export class AzureOpenAIProvider extends BaseAPIProvider {
  private azureEndpoint: string;
  private deploymentName: string;
  private apiVersion: string;

  constructor(config: ProviderConfig & { 
    azureEndpoint: string; 
    deploymentName: string; 
    apiVersion?: string 
  }) {
    super('azure-openai', 'ai', config);
    this.azureEndpoint = config.azureEndpoint;
    this.deploymentName = config.deploymentName;
    this.apiVersion = config.apiVersion || '2024-02-01';
  }

  async execute(request: OpenAIRequest): Promise<APIResponse> {
    const startTime = Date.now();
    const requestId = `azure-openai-${Date.now()}`;

    try {
      if (!this.validateRequest(request)) {
        throw new Error('Invalid request format');
      }

      await this.checkRateLimit();

      const url = `${this.azureEndpoint}/openai/deployments/${this.deploymentName}/chat/completions?api-version=${this.apiVersion}`;
      
      const rawResponse = await this.retryRequest(async () => {
        return await this.makeRequest(url, {
          method: 'POST',
          headers: {
            'api-key': this.config.apiKey,
          },
          body: JSON.stringify(request),
        });
      });

      // Console log the raw response from OpenAI
      console.log('🤖 OpenAI Raw Response:', JSON.stringify(rawResponse, null, 2));
      console.log('🔍 OpenAI Response Summary:', {
        model: rawResponse.model,
        choices: rawResponse.choices?.length || 0,
        content: rawResponse.choices?.[0]?.message?.content?.substring(0, 100) + '...',
        usage: rawResponse.usage,
        finish_reason: rawResponse.choices?.[0]?.finish_reason
      });

      const transformedData = this.transformResponse(rawResponse);
      
      // Console log the transformed data
      console.log('✨ OpenAI Transformed Data:', JSON.stringify(transformedData, null, 2));
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
      
      // Console log OpenAI errors
      console.error('❌ OpenAI Request Error:', {
        requestId,
        error: (error as Error).message,
        stack: (error as Error).stack,
        responseTime,
        url: `${this.azureEndpoint}/openai/deployments/${this.deploymentName}/chat/completions`,
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

  validateRequest(request: OpenAIRequest): boolean {
    return !!(
      request.model &&
      request.messages &&
      Array.isArray(request.messages) &&
      request.messages.length > 0
    );
  }

  transformResponse(rawResponse: any): any {
    return {
      content: rawResponse.choices?.[0]?.message?.content || '',
      model: rawResponse.model,
      usage: rawResponse.usage,
      finishReason: rawResponse.choices?.[0]?.finish_reason,
    };
  }

  protected calculateCost(tokensUsed: number = 0): number {
    // Azure OpenAI pricing (example rates)
    const inputCostPer1K = 0.0015;  // $0.0015 per 1K tokens
    const outputCostPer1K = 0.002;  // $0.002 per 1K tokens
    
    // Simplified calculation - in production you'd track input/output tokens separately
    return (tokensUsed / 1000) * inputCostPer1K;
  }

  async healthCheck(): Promise<boolean> {
    try {
      const testRequest: OpenAIRequest = {
        model: 'gpt-3.5-turbo',
        messages: [{ role: 'user', content: 'Hello' }],
        max_tokens: 1,
      };
      
      const result = await this.execute(testRequest);
      return result.status === 'success';
    } catch {
      return false;
    }
  }
} 