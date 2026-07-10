import { useState } from 'react';
import { AnalysisResult } from '@/lib/domain-analyzer/types';

interface DomainAnalysisState {
  loading: boolean;
  result: AnalysisResult | null;
  error: string | null;
  metadata: {
    processingTime?: number;
    contentLength?: number;
    confidence?: number;
    mode?: string;
    fetchSuccess?: boolean;
    analysisMethod?: string;
  } | null;
}

interface UseDomainAnalysisReturn {
  analyzeState: DomainAnalysisState;
  analyzeDomain: (domain: string, mode?: 'full' | 'quick') => Promise<void>;
  clearAnalysis: () => void;
}

export function useDomainAnalysis(): UseDomainAnalysisReturn {
  const [analyzeState, setAnalyzeState] = useState<DomainAnalysisState>({
    loading: false,
    result: null,
    error: null,
    metadata: null,
  });

  const analyzeDomain = async (domain: string, mode: 'full' | 'quick' = 'full') => {
    setAnalyzeState({
      loading: true,
      result: null,
      error: null,
      metadata: null,
    });

    try {
      const response = await fetch('/api/analyze-domain', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain, mode }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Analysis failed');
      }

      // The new API always returns success: true/false, so we handle both cases
      setAnalyzeState({
        loading: false,
        result: data.analysis,
        error: data.success ? null : (data.error || 'Analysis was not successful'),
        metadata: data.metadata ? {
          processingTime: data.metadata.processingTime,
          contentLength: data.metadata.contentLength,
          confidence: data.analysis?.confidence,
          mode: data.metadata.mode,
          fetchSuccess: data.metadata.fetchSuccess,
          analysisMethod: data.metadata.analysisMethod,
        } : null,
      });

    } catch (error) {
      setAnalyzeState({
        loading: false,
        result: null,
        error: (error as Error).message,
        metadata: null,
      });
    }
  };

  const clearAnalysis = () => {
    setAnalyzeState({
      loading: false,
      result: null,
      error: null,
      metadata: null,
    });
  };

  return {
    analyzeState,
    analyzeDomain,
    clearAnalysis,
  };
} 