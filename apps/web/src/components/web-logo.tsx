import { useState } from 'react';
import { Globe } from 'lucide-react';

interface WebLogoProps {
  domain?: string | null;
  className?: string;
  size?: number; // Container size - favicon will use closest allowed size (16, 32, 40, 48, 64)
  alt?: string;
}

export function WebLogo({ 
  domain, 
  className = '', 
  size = 64, 
  alt 
}: WebLogoProps) {
  const [hasError, setHasError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Handle undefined or empty domain
  if (!domain || typeof domain !== 'string') {
    return (
      <div 
        className={`relative flex shrink-0 items-center justify-center bg-muted border border-border overflow-hidden ${className}`}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          borderRadius: '8px',
        }}
      >
        <Globe className="h-1/2 w-1/2 text-muted-foreground" />
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
      className={`relative flex shrink-0 items-center justify-center bg-muted border border-border overflow-hidden ${className}`}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: '8px', // Using slightly less round borders matching normal design
      }}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted animate-pulse z-10">
          <Globe className="h-1/2 w-1/2 text-muted-foreground" />
        </div>
      )}
      
      {hasError ? (
        <div className="flex items-center justify-center w-full h-full bg-muted">
          <Globe className="h-1/2 w-1/2 text-muted-foreground" />
        </div>
      ) : (
        <img
          src={faviconUrl}
          alt={alt || `${cleanDomain} logo`}
          width={size}
          height={size}
          className={`object-cover w-full h-full ${isLoading ? 'opacity-0' : 'opacity-100 transition-opacity duration-200'}`}
          onLoad={handleImageLoad}
          onError={handleImageError}
        />
      )}
    </div>
  );
}
