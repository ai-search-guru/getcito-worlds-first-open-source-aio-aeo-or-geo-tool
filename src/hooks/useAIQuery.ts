import { useState } from 'react';
import { APIResponse } from '@/lib/api-providers/types';

export interface AIQueryResult {
  requestId: string;
  data: any;
  results: APIResponse[];
  totalCost: number;
  completedAt: Date;
  debug?: {
    providersExecuted: string[];
    serverLogs: string;
    timestamp: string;
  };
}

export interface AIQueryState {
  loading: boolean;
  result: AIQueryResult | null;
  error: string | null;
}

export function useAIQuery() {
  const [queryState, setQueryState] = useState<AIQueryState>({
    loading: false,
    result: null,
    error: null,
  });

  const executeQuery = async (
    prompt: string,
    providers: string[] = ['azure-openai', 'google-gemini'],
    priority: 'low' | 'medium' | 'high' = 'medium',
    userId: string = 'default-user'
  ): Promise<AIQueryResult | null> => {
    setQueryState(prev => ({
      ...prev,
      loading: true,
      error: null,
    }));

    try {
      console.log('🚀 Executing AI Query:', {
        prompt: prompt.substring(0, 100) + '...',
        providers,
        priority,
        userId
      });

      const response = await fetch('/api/ai-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          prompt,
          providers,
          priority,
          userId,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.success) {
        throw new Error(data.error || 'API query failed');
      }

      const result: AIQueryResult = {
        requestId: data.requestId,
        data: data.data,
        results: data.results,
        totalCost: data.totalCost,
        completedAt: new Date(data.completedAt),
        debug: data.debug,
      };

      console.log('✅ AI Query Completed:', {
        requestId: result.requestId,
        resultsCount: result.results?.length || 0,
        totalCost: result.totalCost,
        providersExecuted: result.debug?.providersExecuted || []
      });

      setQueryState(prev => ({
        ...prev,
        loading: false,
        result,
        error: null,
      }));

      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
      console.error('❌ AI Query Error:', errorMessage);
      
      setQueryState(prev => ({
        ...prev,
        loading: false,
        error: errorMessage,
      }));

      return null;
    }
  };

  const clearQuery = () => {
    setQueryState({
      loading: false,
      result: null,
      error: null,
    });
  };

  const getProviderStatus = async () => {
    try {
      const response = await fetch('/api/ai-query', {
        method: 'GET',
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('Provider Status Error:', error);
      return null;
    }
  };

  return {
    queryState,
    executeQuery,
    clearQuery,
    getProviderStatus,
  };
} 