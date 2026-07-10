'use client'
import { useState, useCallback } from 'react';

interface QueryOptions {
  provider?: 'openai' | 'gemini' | 'both';
  context?: string;
}

interface QueryResult {
  provider: string;
  response: string;
  error?: string;
  timestamp: string;
}

interface UseUserQueryReturn {
  query: (text: string, options?: QueryOptions) => Promise<void>;
  results: QueryResult[];
  loading: boolean;
  error: string | null;
  clearResults: () => void;
}

export function useUserQuery(): UseUserQueryReturn {
  const [results, setResults] = useState<QueryResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = useCallback(async (text: string, options?: QueryOptions) => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/user-query', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query: text,
          provider: options?.provider || 'both',
          context: options?.context,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to query AI providers');
      }

      setResults(data.results);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);
      console.error('User query error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearResults = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  return {
    query,
    results,
    loading,
    error,
    clearResults,
  };
} 