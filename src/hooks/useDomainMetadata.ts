import { useState } from 'react';
import { DomainMetadata } from '@/lib/domain-metadata';

interface DomainMetadataState {
  loading: boolean;
  result: DomainMetadata | null;
  error: string | null;
  metadata: {
    timestamp?: string;
    source?: string;
  } | null;
}

interface UseDomainMetadataReturn {
  metadataState: DomainMetadataState;
  getDomainMetadata: (domain: string) => Promise<void>;
  clearMetadata: () => void;
}

export function useDomainMetadata(): UseDomainMetadataReturn {
  const [metadataState, setMetadataState] = useState<DomainMetadataState>({
    loading: false,
    result: null,
    error: null,
    metadata: null,
  });

  const getDomainMetadata = async (domain: string) => {
    setMetadataState({
      loading: true,
      result: null,
      error: null,
      metadata: null,
    });

    try {
      console.log('🚀 Fetching domain metadata for:', domain);
      
      const response = await fetch('/api/get-domain-metadata', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ domain }),
      });

      const data = await response.json();
      
      console.log('📄 Metadata API Response:', data);

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get domain metadata');
      }

      if (!data.success) {
        throw new Error(data.error || 'Domain metadata fetch was not successful');
      }

      console.log('✅ Domain metadata fetched successfully:', {
        title: data.data.title,
        description: data.data.description?.substring(0, 100) + '...',
        hasImage: !!data.data.image,
        siteName: data.data.siteName
      });

      setMetadataState({
        loading: false,
        result: data.data,
        error: null,
        metadata: data.metadata,
      });

    } catch (error) {
      console.error('❌ Domain metadata fetch failed:', error);
      
      setMetadataState({
        loading: false,
        result: null,
        error: (error as Error).message,
        metadata: null,
      });
    }
  };

  const clearMetadata = () => {
    setMetadataState({
      loading: false,
      result: null,
      error: null,
      metadata: null,
    });
  };

  return {
    metadataState,
    getDomainMetadata,
    clearMetadata,
  };
} 