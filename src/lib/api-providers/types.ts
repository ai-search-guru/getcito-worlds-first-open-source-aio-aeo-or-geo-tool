// Core types for the multi-provider API system

export interface APIProvider {
  name: string;
  type: 'ai' | 'seo' | 'data' | 'analytics';
  enabled: boolean;
  rateLimit: {
    requestsPerMinute: number;
    requestsPerDay: number;
  };
  cost: {
    perRequest: number;
    currency: string;
  };
}

export interface APIRequest {
  id: string;
  prompt: string;
  providers: string[];
  priority: 'low' | 'medium' | 'high';
  userId: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

export interface APIResponse {
  providerId: string;
  requestId: string;
  status: 'success' | 'error' | 'timeout';
  data?: any;
  error?: string;
  responseTime: number;
  cost: number;
  timestamp: Date;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  timeout: number;
  retryAttempts: number;
  customHeaders?: Record<string, string>;
}

export interface JobResult {
  requestId: string;
  results: APIResponse[];
  aggregatedData?: any;
  totalCost: number;
  completedAt: Date;
}

// Provider-specific types
export interface OpenAIRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
}

export interface ChatGPTSearchRequest {
  input: string;
  model?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface AzureOpenAISearchRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
  data_sources?: Array<{
    type: 'azure_search';
    parameters: {
      endpoint: string;
      index_name: string;
      authentication: {
        type: 'api_key' | 'system_assigned_managed_identity' | 'user_assigned_managed_identity';
        key?: string;
        managed_identity_resource_id?: string;
      };
      query_type?: 'simple' | 'semantic' | 'vector';
      in_scope?: boolean;
      top_n_documents?: number;
      strictness?: number;
      role_information?: string;
      embedding_dependency?: {
        type: 'deployment_name';
        deployment_name: string;
      };
      fields_mapping?: {
        content_fields?: string[];
        filepath_field?: string;
        title_field?: string;
        url_field?: string;
        vector_fields?: string[];
      };
    };
  }>;
}

export interface PerplexityRequest {
  prompt?: string;
  input?: string;
  messages?: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  // Experimental search parameters for better results
  search_domain_filter?: string[];
  search_recency_filter?: 'month' | 'week' | 'day' | 'hour';
  return_citations?: boolean;
  return_images?: boolean;
  return_related_questions?: boolean;
}

export interface GoogleAIOverviewRequest {
  keyword: string;
  location_code?: number;
  language_code?: string;
  device?: 'desktop' | 'mobile' | 'tablet';
  os?: 'windows' | 'macos' | 'linux' | 'android' | 'ios';
  depth?: number;
  group_organic_results?: boolean;
  load_async_ai_overview?: boolean;
  people_also_ask_click_depth?: number;
}

export interface GeminiRequest {
  contents: Array<{
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

export interface SEORequest {
  url: string;
  keywords?: string[];
  location?: string;
  language?: string;
}

export interface TracxnRequest {
  query: string;
  filters?: {
    industry?: string;
    location?: string;
    fundingStage?: string;
  };
} 