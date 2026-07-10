'use client'
import React, { useState } from 'react';
import Image from 'next/image';
import { Globe } from 'lucide-react';

interface WebLogoProps {
  domain: string;
  className?: string;
  size?: number; // Container size - favicon will use closest allowed size (16, 32, 40, 48, 64)
  alt?: string;
}

export default function WebLogo({ 
  domain, 
  className = '', 
  size = 64, 
  alt 
}: WebLogoProps): React.ReactElement {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Handle undefined or empty domain
  if (!domain || typeof domain !== 'string') {
    return (
      <div 
        className={`relative flex items-center justify-center bg-muted border border-border overflow-hidden ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '12px',
        }}
      >
        <Globe className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  // Clean the domain to ensure it's in the right format
  const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  
  // Construct the full URL with https:// prefix (no www) as required by the service
  const fullUrl = `https://${cleanDomain}`;
  
  // Ensure size is one of the allowed values (16, 32, 40, 48, 64)
  // If not, default to closest smaller size to prevent stretching
  const allowedSizes = [16, 32, 40, 48, 64];
  const actualSize = allowedSizes.find(s => s >= size) || 64;
  
  // Construct the favicon URL using the correct format
  const faviconUrl = `https://t1.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=${encodeURIComponent(fullUrl)}&size=${actualSize}`;
  
  const handleImageLoad = () => {
    setIsLoading(false);
    setHasError(false);
  };

  const handleImageError = () => {
    setIsLoading(false);
    setHasError(true);
  };

  return (
    <div 
      className={`relative flex items-center justify-center bg-muted border border-border overflow-hidden ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '12px',
      }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
      )}
      
      {hasError ? (
        <div className="flex items-center justify-center w-full h-full bg-muted">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
      ) : (
        <Image
          src={faviconUrl}
          alt={alt || `${cleanDomain} logo`}
          width={actualSize}
          height={actualSize}
          className="object-contain max-w-full max-h-full"
          onLoad={handleImageLoad}
          onError={handleImageError}
          unoptimized // Since we're loading from external service
        />
      )}
    </div>
  );
} 