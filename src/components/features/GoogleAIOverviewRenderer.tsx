'use client'
import React from 'react';
import WebLogo from '@/components/shared/WebLogo';

// Google AI Overview-specific markdown renderer
function GoogleAIOverviewMarkdownRenderer({ content }: { content: string }) {
  const cleanAndParseContent = (text: string) => {
    if (!text) return text;
    
    // Google AI Overview-specific content cleaning
    let cleaned = text;
    
    // Fix malformed source citations like (source=openai" target="_blank"...)
    cleaned = cleaned.replace(/\(source=([^"]+)"\s+target="_blank"[^>]*>([^)]+)\)/g, '[$2]($2) *(source: $1)*');
    
    // Clean up broken Google search links
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*\s*[^)]*\)/g, '');
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*$/g, '');
    
    // Clean up broken URLs with search parameters
    cleaned = cleaned.replace(/esv=[^&\s]+&[^"\s]*/g, '');
    
    // Fix malformed links that start with parameters
    cleaned = cleaned.replace(/hl=en&gl=US[^"\s]*/g, '');
    
    // Convert numbered citations [[1]] to cleaner format
    cleaned = cleaned.replace(/\[\[(\d+)\]\]\([^)]+\)/g, '[$1]');
    
    // Clean up excessive whitespace but preserve paragraph breaks
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/[ \t]*\n[ \t]*/g, '\n');
    
    return cleaned.trim();
  };

  const renderMarkdown = (text: string) => {
    if (!text) return text;
    
    let processed = cleanAndParseContent(text);
    
    // Handle code blocks first (```code```)
    processed = processed.replace(/```([^`]+)```/g, '<pre class="bg-gray-100 border border-gray-200 rounded-lg p-4 overflow-x-auto my-4"><code class="text-sm text-gray-800">$1</code></pre>');
    
    // Handle inline code (`code`)
    processed = processed.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm font-mono">$1</code>');
    
    // Handle bold (**text** or __text__)
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
    processed = processed.replace(/__([^_]+)__/g, '<strong class="font-semibold text-gray-900">$1</strong>');
    
    // Handle italic (*text* or _text_) - but not source citations
    processed = processed.replace(/\*([^*()]+)\*/g, '<em class="italic text-gray-700">$1</em>');
    processed = processed.replace(/_([^_()]+)_/g, '<em class="italic text-gray-700">$1</em>');
    
    // Handle source citations with special styling (BEFORE processing other markdown)
    processed = processed.replace(/\*\(source:\s*([^)]+)\)\*/g, '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 ml-2">Google AI Source: $1</span>');
    
    // Handle links [text](url) - preserve original markdown functionality
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline font-medium">$1</a>');
    
    // Handle numbered citations [1], [2], etc. (AFTER links to avoid conflicts)
    processed = processed.replace(/\[(\d+)\](?!\()/g, '<sup class="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-500 rounded-full ml-1">$1</sup>');
    
    // Handle headers
    processed = processed.replace(/^### (.+)$/gm, '<h3 class="text-lg font-semibold text-gray-900 mt-6 mb-3">$1</h3>');
    processed = processed.replace(/^## (.+)$/gm, '<h2 class="text-xl font-semibold text-gray-900 mt-6 mb-4">$1</h2>');
    processed = processed.replace(/^# (.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-4">$1</h1>');
    
    // Convert line breaks to HTML
    processed = processed.replace(/\n/g, '<br/>');
    
    // Wrap in paragraph if not already wrapped
    if (!processed.startsWith('<')) {
      processed = '<p class="mb-4 text-gray-700 leading-relaxed">' + processed + '</p>';
    }
    
    return processed;
  };

  const htmlContent = renderMarkdown(content);
  
  return (
    <div 
      className="prose prose-gray max-w-none prose-headings:text-gray-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-code:text-gray-800 prose-pre:bg-gray-100 prose-a:text-blue-600"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}

// Google AI Overview-specific citation extractor
export function extractGoogleAIOverviewCitations(text: string, googleAIData?: any): { url: string; text: string; source?: string }[] {
  if (!text && !googleAIData) return [];
  
  const citations: { url: string; text: string; source?: string }[] = [];
  const seen = new Set<string>();
  
  const normalizeUrl = (url: string): string => {
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname;
    } catch {
      return url.trim();
    }
  };
  
  // Extract Google search URLs first (before they get cleaned)
  const googleSearchPattern = /https:\/\/www\.google\.com\/search\?[^\s<>"{}|\\^`[\]]+/g;
  const googleSearchUrls = (text || '').match(googleSearchPattern) || [];
  googleSearchUrls.forEach(url => {
    if (url && url.trim() && !seen.has(url)) {
      citations.push({ 
        text: 'Google Search', 
        url: url.trim(), 
        source: 'Google Search' 
      });
      seen.add(url);
    }
  });
  
  // Extract malformed source citations like (source=openai" target="_blank"...)
  const malformedSourcePattern = /\(source=([^"]+)"\s+target="_blank"[^>]*>([^)]+)\)/g;
  let match;
  while ((match = malformedSourcePattern.exec(text || '')) !== null) {
    const source = match[1];
    const domain = match[2];
    if (domain && domain.trim()) {
      const url = domain.startsWith('http') ? domain : `https://${domain}`;
      const normalizedUrl = normalizeUrl(url);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = url.includes('google.com/search?');
        citations.push({ 
          text: isGoogleSearch ? 'Google Search' : domain, 
          url, 
          source: isGoogleSearch ? 'Google Search' : 'Google AI Overview'
        });
        seen.add(normalizedUrl);
      }
    }
  }
  
  // Extract numbered citations with URLs [[1]](url)
  const numberedCitationPattern = /\[\[(\d+)\]\]\(([^)]+)\)/g;
  while ((match = numberedCitationPattern.exec(text || '')) !== null) {
    const citationNumber = match[1];
    const url = match[2];
    if (url && url.trim()) {
      const normalizedUrl = normalizeUrl(url);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = url.includes('google.com/search?');
        
        if (isGoogleSearch) {
          citations.push({ text: 'Google Search', url: url.trim(), source: 'Google Search' });
        } else {
          let displayText = url;
          try {
            const urlObj = new URL(url);
            displayText = urlObj.hostname.replace('www.', '');
          } catch (e) {
            displayText = url;
          }
          citations.push({ text: `Citation ${citationNumber}: ${displayText}`, url: url.trim(), source: 'Google AI Overview' });
        }
        seen.add(normalizedUrl);
      }
    }
  }
  
  // Extract markdown links [text](url)
  const markdownLinks = (text || '').match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
  markdownLinks.forEach(link => {
    const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
    if (match && match[2] && match[2].trim()) {
      const normalizedUrl = normalizeUrl(match[2]);
      if (!seen.has(normalizedUrl)) {
        // Skip if it's a numbered citation (already handled above)
        if (!match[1].match(/^\d+$/)) {
          const isGoogleSearch = match[2].includes('google.com/search?');
          citations.push({ 
            text: isGoogleSearch ? 'Google Search' : (match[1] || match[2]), 
            url: match[2].trim(), 
            source: isGoogleSearch ? 'Google Search' : 'Google AI Overview'
          });
          seen.add(normalizedUrl);
        }
      }
    }
  });
  
  // Extract plain URLs
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const urls = (text || '').match(urlRegex) || [];
  urls.forEach(url => {
    let cleanUrl = url.replace(/esv=[^&\s]+&[^&\s]*/g, '').replace(/&+/g, '&').replace(/[&?]$/, '');
    if (cleanUrl && cleanUrl.trim()) {
      const normalizedUrl = normalizeUrl(cleanUrl);
      if (!seen.has(normalizedUrl)) {
        const isGoogleSearch = cleanUrl.includes('google.com/search?');
        
        if (isGoogleSearch) {
          citations.push({ text: 'Google Search', url: cleanUrl.trim(), source: 'Google Search' });
        } else {
          let displayText = cleanUrl;
          try {
            const urlObj = new URL(cleanUrl);
            displayText = urlObj.hostname.replace('www.', '');
          } catch (e) {
            displayText = cleanUrl;
          }
          citations.push({ text: displayText, url: cleanUrl.trim(), source: 'Google AI Overview' });
        }
        seen.add(normalizedUrl);
      }
    }
  });
  
  // Extract domain references like (time.com), (arxiv.org), etc.
  const domainPattern = /\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
  let domainMatch;
  while ((domainMatch = domainPattern.exec(text || '')) !== null) {
    const domain = domainMatch[1];
    const url = `https://${domain}`;
    if (!seen.has(url)) {
      citations.push({ text: domain, url, source: 'Google AI Overview' });
      seen.add(url);
    }
  }

  // Extract citations from AI Overview references if available
  if (googleAIData?.aiOverviewReferences && Array.isArray(googleAIData.aiOverviewReferences)) {
    googleAIData.aiOverviewReferences.forEach((ref: any) => {
      if (ref.url && ref.url.trim()) {
        const normalizedUrl = normalizeUrl(ref.url);
        if (!seen.has(normalizedUrl)) {
          citations.push({
            text: ref.title || ref.domain || ref.text || ref.url,
            url: ref.url.trim(),
            source: 'AI Overview Reference'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }
  
  return citations;
}

// Google AI Overview Response Component
interface GoogleAIOverviewResponseProps {
  googleAIData: any;
}

export function GoogleAIOverviewResponse({ googleAIData }: GoogleAIOverviewResponseProps) {
  // Check for AI Overview presence in multiple ways
  const hasAIOverview = googleAIData?.hasAIOverview || 
                       googleAIData?.aiOverview || 
                       (googleAIData?.aiOverviewItems && googleAIData.aiOverviewItems.length > 0);
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="text-sm font-semibold text-gray-700">Google AI Overview Response</span>
          </div>
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            <span className="text-sm font-semibold text-gray-700">Real-time Search Enabled in Starter & Trial Plan</span>
          </div>
        </div>
      </div>
      <div className="p-6">
        <div className="prose prose-gray max-w-none">
          <GoogleAIOverviewMarkdownRenderer content={googleAIData?.aiOverview || 'No AI Overview available'} />
        </div>
      </div>
    </div>
  );
}

// Google AI Overview Citations Component
interface GoogleAIOverviewCitationsProps {
  googleAIData: any;
}

export function GoogleAIOverviewCitations({ googleAIData }: GoogleAIOverviewCitationsProps) {
  const links = extractGoogleAIOverviewCitations(googleAIData?.aiOverview || '', googleAIData);
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
          <span className="text-sm font-semibold text-gray-700">Google AI Overview Web References ({links.length})</span>
        </div>
      </div>
      <div className="p-6">
        {links.length > 0 ? (
          <div className="space-y-3">
            {links.map((link, index) => (
              <div key={index} className={`flex items-start space-x-3 p-3 rounded-lg border ${
                link.source === 'Google Search' 
                  ? 'bg-green-50 border-green-100' 
                  : 'bg-blue-50 border-blue-100'
              }`}>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  link.source === 'Google Search' 
                    ? 'bg-green-100' 
                    : 'bg-blue-100'
                }`}>
                  <span className={`text-xs font-bold ${
                    link.source === 'Google Search' 
                      ? 'text-green-700' 
                      : 'text-blue-700'
                  }`}>{index + 1}</span>
                </div>
                <div className="flex-shrink-0">
                  {link.source === 'Google Search' ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  ) : (
                    link.url && <WebLogo domain={link.url} className="w-[18px] h-[18px]" size={18} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <a 
                    href={link.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className={`font-medium text-sm block truncate ${
                      link.source === 'Google Search' 
                        ? 'text-green-600 hover:text-green-800' 
                        : 'text-blue-600 hover:text-blue-800'
                    }`}
                    title={link.text}
                  >
                    {link.text}
                  </a>
                  <p className="text-xs text-gray-500 mt-1 truncate">{link.url}</p>
                  {link.source && (
                    <p className={`text-xs mt-1 ${
                      link.source === 'Google Search' 
                        ? 'text-green-600' 
                        : 'text-blue-600'
                    }`}>Source: {link.source}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">No Links Found</h3>
            <p className="text-xs text-gray-600">No web references were found in the AI Overview content</p>
          </div>
        )}
      </div>
    </div>
  );
} 