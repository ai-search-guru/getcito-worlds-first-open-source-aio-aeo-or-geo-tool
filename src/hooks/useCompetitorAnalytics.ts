import { useState, useCallback } from 'react';

export type ProcessingState = 'idle' | 'processing' | 'completed' | 'error';

export interface CompetitorAnalyticsProgress {
  totalQueries: number;
  processedQueries: number;
  lastProcessedAt?: Date;
  error?: string;
}

export function useCompetitorAnalytics() {
  const [state, setState] = useState<ProcessingState>('idle');
  const [progress, setProgress] = useState<CompetitorAnalyticsProgress>({ totalQueries: 0, processedQueries: 0 });

  const startProcessing = useCallback((total: number) => {
    setState('processing');
    setProgress({ totalQueries: total, processedQueries: 0 });
  }, []);

  const updateProgress = useCallback((processed: number) => {
    setProgress((prev) => ({ ...prev, processedQueries: processed }));
  }, []);

  const completeProcessing = useCallback(() => {
    setState('completed');
    setProgress((prev) => ({ ...prev, lastProcessedAt: new Date() }));
  }, []);

  const setError = useCallback((error: string) => {
    setState('error');
    setProgress((prev) => ({ ...prev, error }));
  }, []);

  const reset = useCallback(() => {
    setState('idle');
    setProgress({ totalQueries: 0, processedQueries: 0 });
  }, []);

  return {
    state,
    progress,
    startProcessing,
    updateProgress,
    completeProcessing,
    setError,
    reset,
  };
} 