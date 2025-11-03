import React from 'react';
import WebLogo from '@/components/shared/WebLogo';

interface Citation {
  url: string;
  text: string;
  source?: string;
  index?: number;
  type?: string;
  title?: string;
  date?: string;
}

interface PerplexityData {
  response: string;
  citationsData?: string;
  searchResultsData?: string;
  structuredCitationsData?: string;
  citationsList?: any[];
  searchResults?: any[];
  structuredCitations?: any[];
  citationsCount?: number;
  searchResultsCount?: number;
  structuredCitationsCount?: number;
  realTimeData?: boolean;
  timestamp?: string;
  responseTime?: number;
}

interface PerplexityResponseRendererProps {
  data: PerplexityData;
  activeTab?: 'response' | 'citations';
}

// Enhanced markdown renderer specifically for Perplexity responses
function PerplexityMarkdownRenderer({ content }: { content: string }) {
  const cleanPerplexityContent = (text: string) => {
    if (!text) return text;
    
    let cleaned = text;
    
    // Clean up Perplexity-specific formatting issues
    // Fix malformed citations and links
    cleaned = cleaned.replace(/\(source=([^"]+)"\s+target="_blank"[^>]*>([^)]+)\)/g, '[$2]($2) *(source: $1)*');
    
    // Clean up broken search links
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*\s*[^)]*\)/g, '');
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*$/g, '');
    
    // Clean up URL parameters
    cleaned = cleaned.replace(/esv=[^&\s]+&[^"\s]*/g, '');
    cleaned = cleaned.replace(/hl=en&gl=US[^"\s]*/g, '');
    
    // Normalize Perplexity's numbered citations [[1]] to [1]
    cleaned = cleaned.replace(/\[\[(\d+)\]\]\([^)]+\)/g, '[$1]');
    
    // Clean excessive whitespace
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleaned = cleaned.replace(/[ \t]+/g, ' ');
    cleaned = cleaned.replace(/[ \t]*\n[ \t]*/g, '\n');
    
    return cleaned.trim();
  };

  const renderPerplexityMarkdown = (text: string) => {
    if (!text) return text;
    
    let processed = cleanPerplexityContent(text);
    
    // Handle code blocks first
    processed = processed.replace(/```([^`]+)```/g, '<pre class="bg-gray-100 border border-gray-200 rounded-lg p-4 overflow-x-auto my-4"><code class="text-sm text-gray-800">$1</code></pre>');
    
    // Handle inline code
    processed = processed.replace(/`([^`]+)`/g, '<code class="bg-gray-100 text-gray-800 px-2 py-1 rounded text-sm font-mono">$1</code>');
    
    // Handle bold text
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>');
    processed = processed.replace(/__([^_]+)__/g, '<strong class="font-semibold text-gray-900">$1</strong>');
    
    // Handle italic text (avoiding source citations)
    processed = processed.replace(/\*([^*()]+)\*/g, '<em class="italic text-gray-700">$1</em>');
    processed = processed.replace(/_([^_()]+)_/g, '<em class="italic text-gray-700">$1</em>');
    
    // Handle Perplexity source citations with enhanced styling
    processed = processed.replace(/\*\(source:\s*([^)]+)\)\*/g, '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 ml-2">📚 $1</span>');
    
    // Handle standard markdown links
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-purple-600 hover:text-purple-800 underline font-medium">$1</a>');
    
    // Handle Perplexity's numbered citations with enhanced styling
    processed = processed.replace(/\[(\d+)\](?!\()/g, '<sup class="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-purple-500 rounded-full ml-1 hover:bg-purple-600 transition-colors cursor-pointer" title="Citation $1">$1</sup>');
    
    // Handle headers with Perplexity branding
    processed = processed.replace(/^###\s*(.+)$/gm, '<h3 class="text-lg font-semibold text-purple-900 mt-6 mb-3 border-b border-purple-200 pb-2">$1</h3>');
    processed = processed.replace(/^##\s*(.+)$/gm, '<h2 class="text-xl font-semibold text-purple-900 mt-6 mb-3 border-b border-purple-200 pb-2">$1</h2>');
    processed = processed.replace(/^#\s*(.+)$/gm, '<h1 class="text-2xl font-bold text-purple-900 mt-6 mb-4 border-b border-purple-200 pb-2">$1</h1>');
    
    // Handle numbered headers
    processed = processed.replace(/^###\s*\d+\.\s*(.+)$/gm, '<h3 class="text-lg font-semibold text-purple-900 mt-6 mb-3 border-b border-purple-200 pb-2">$1</h3>');
    processed = processed.replace(/^##\s*\d+\.\s*(.+)$/gm, '<h2 class="text-xl font-semibold text-purple-900 mt-6 mb-3 border-b border-purple-200 pb-2">$1</h2>');
    processed = processed.replace(/^#\s*\d+\.\s*(.+)$/gm, '<h1 class="text-2xl font-bold text-purple-900 mt-6 mb-4 border-b border-purple-200 pb-2">$1</h1>');
    
    // Handle special sections with Perplexity theming
    processed = processed.replace(/^(Key Features?|Benefits?|Advantages?|Disadvantages?|Pros?|Cons?):\s*$/gm, '<div class="bg-gradient-to-r from-purple-50 to-indigo-50 border-l-4 border-purple-400 p-4 my-4 rounded-r-lg"><h4 class="text-lg font-semibold text-purple-900 mb-2">$1</h4></div>');
    
    // Enhanced list processing
    const lines = processed.split('\n');
    let inOrderedList = false;
    let inUnorderedList = false;
    const processedLines = lines.map(line => {
      const isNumberedBullet = /^\d+\.\s+(.+)$/.test(line.trim());
      const isUnorderedBullet = /^[-*]\s+(.+)$/.test(line.trim());
      
      if (isNumberedBullet && !inOrderedList) {
        inUnorderedList = false;
        inOrderedList = true;
        return '<ol class="list-decimal list-inside space-y-2 my-4 ml-4 text-gray-700">\n<li class="leading-relaxed">' + line.replace(/^\d+\.\s+(.+)$/, '$1') + '</li>';
      } else if (isNumberedBullet && inOrderedList) {
        return '<li class="leading-relaxed">' + line.replace(/^\d+\.\s+(.+)$/, '$1') + '</li>';
      } else if (isUnorderedBullet && !inUnorderedList) {
        inOrderedList = false;
        inUnorderedList = true;
        return '<ul class="list-disc list-inside space-y-2 my-4 ml-4 text-gray-700">\n<li class="leading-relaxed">' + line.replace(/^[-*]\s+(.+)$/, '$1') + '</li>';
      } else if (isUnorderedBullet && inUnorderedList) {
        return '<li class="leading-relaxed">' + line.replace(/^[-*]\s+(.+)$/, '$1') + '</li>';
      } else if (!isNumberedBullet && !isUnorderedBullet && inOrderedList) {
        inOrderedList = false;
        return '</ol>\n' + line;
      } else if (!isNumberedBullet && !isUnorderedBullet && inUnorderedList) {
        inUnorderedList = false;
        return '</ul>\n' + line;
      }
      
      return line;
    });
    
    if (inOrderedList) processedLines.push('</ol>');
    if (inUnorderedList) processedLines.push('</ul>');
    
    processed = processedLines.join('\n');
    
    // Perplexity-specific enhancements
    // Highlight pricing with purple theme
    processed = processed.replace(/(\$[\d,]+(?:\.\d{2})?(?:\s*per\s*month|\s*\/month)?)/gi, '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800 mx-1">💰 $1</span>');
    
    // Highlight tool names and brands with Perplexity theming
    processed = processed.replace(/\b(SEMrush|Ahrefs|Ubersuggest|Google Analytics|Google Search Console|Surfer SEO|SEOptimer|ChatGPT|OpenAI|Gemini|Perplexity|Claude|Anthropic)\b/g, '<span class="font-medium text-purple-700 bg-purple-50 px-1 py-0.5 rounded text-sm">$1</span>');
    
    // Highlight real-time data indicators
    processed = processed.replace(/\b(real-time|live|current|latest|updated|recent)\b/gi, '<span class="inline-flex items-center px-1 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">🔄 $1</span>');
    
    // Handle paragraphs and line breaks
    processed = processed.replace(/\n\n/g, '</p><p class="mb-4 text-gray-700 leading-relaxed">');
    processed = processed.replace(/\n/g, '<br/>');
    
    // Wrap in paragraph if needed
    if (!processed.startsWith('<')) {
      processed = '<p class="mb-4 text-gray-700 leading-relaxed">' + processed + '</p>';
    }
    
    return processed;
  };

  const htmlContent = renderPerplexityMarkdown(content);
  
  return (
    <div 
      className="prose prose-purple max-w-none prose-headings:text-purple-900 prose-p:text-gray-700 prose-strong:text-gray-900 prose-code:text-gray-800 prose-pre:bg-gray-100 prose-a:text-purple-600"
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
}

// Enhanced citation extractor for Perplexity
export function extractPerplexityCitations(text: string, perplexityData?: PerplexityData): Citation[] {
  const citations: Citation[] = [];
  const seen = new Set<string>();
  
  // Extract from flattened citations data (primary source)
  if (perplexityData?.citationsData && perplexityData.citationsData.trim()) {
    const citationUrls = perplexityData.citationsData.split('|||').filter(Boolean);
    citationUrls.forEach((citation: string, index: number) => {
      if (citation && citation.trim()) {
        const normalizedUrl = citation.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: normalizedUrl,
            source: 'Perplexity Citation',
            index: index + 1,
            type: 'structured'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }
  
  // Extract from flattened search results data
  if (perplexityData?.searchResultsData && perplexityData.searchResultsData.trim()) {
    const searchResults = perplexityData.searchResultsData.split('###').filter(Boolean);
    searchResults.forEach((result: string, index: number) => {
      const [title, url] = result.split('|||');
      if (url && url.trim()) {
        const normalizedUrl = url.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: title || url,
            source: 'Perplexity Search Result',
            index: index + 1,
            type: 'search_result',
            title: title || ''
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }
  
  // Extract from flattened structured citations data
  if (perplexityData?.structuredCitationsData && perplexityData.structuredCitationsData.trim()) {
    const structuredCitations = perplexityData.structuredCitationsData.split('|||').filter(Boolean);
    structuredCitations.forEach((citation: string, index: number) => {
      if (citation && citation.trim()) {
        const normalizedUrl = citation.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: normalizedUrl,
            source: 'Perplexity Structured Citation',
            index: index + 1,
            type: 'structured'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }
  
  // Legacy support for array format
  if (perplexityData?.citationsList && Array.isArray(perplexityData.citationsList)) {
    perplexityData.citationsList.forEach((citation: any, index: number) => {
      if (citation.url && citation.url.trim()) {
        const normalizedUrl = citation.url.trim();
        if (!seen.has(normalizedUrl)) {
          citations.push({
            url: normalizedUrl,
            text: citation.text || citation.title || normalizedUrl,
            source: citation.source || 'Perplexity Citation',
            index: index + 1,
            type: 'legacy'
          });
          seen.add(normalizedUrl);
        }
      }
    });
  }
  
  // Fallback: extract from text content
  if (text && citations.length === 0) {
    // Extract Google search URLs
    const googleSearchPattern = /https:\/\/www\.google\.com\/search\?[^\s<>"{}|\\^`[\]]+/g;
    const googleSearchUrls = text.match(googleSearchPattern) || [];
    googleSearchUrls.forEach((url, index) => {
      if (url && url.trim() && !seen.has(url)) {
        citations.push({ 
          text: 'Google Search', 
          url: url.trim(), 
          source: 'Google Search',
          index: index + 1,
          type: 'text_extraction'
        });
        seen.add(url);
      }
    });
    
    // Extract numbered citations [1], [2], etc.
    const numberedMatches = text.match(/\[(\d+)\]/g) || [];
    const citationNumbers = [...new Set(numberedMatches.map(match => match.match(/\[(\d+)\]/)![1]))];
    
    // Extract markdown links
    const markdownLinks = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
    markdownLinks.forEach((link, index) => {
      const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (match && !seen.has(match[2])) {
        citations.push({ 
          text: match[1], 
          url: match[2],
          index: index + 1,
          type: 'markdown_link'
        });
        seen.add(match[2]);
      }
    });
    
    // Extract plain URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];
    urls.forEach((url, index) => {
      if (!seen.has(url)) {
        citations.push({ 
          text: url, 
          url,
          index: index + 1,
          type: 'plain_url'
        });
        seen.add(url);
      }
    });
    
    // Extract domain references (domain.com)
    const domainPattern = /\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
    let domainMatch;
    while ((domainMatch = domainPattern.exec(text)) !== null) {
      const domain = domainMatch[1];
      const url = `https://${domain}`;
      if (!seen.has(url)) {
        citations.push({ 
          text: domain, 
          url,
          type: 'domain_reference'
        });
        seen.add(url);
      }
    }
  }
  
  // Always ignore the first citation as requested
  const filteredCitations = citations.length > 0 ? citations.slice(1) : citations;
  
  return filteredCitations;
}

// Helper function to analyze citation diversity
function analyzeCitationDiversity(citations: Citation[]) {
  const domains = citations.map(c => {
    try {
      return new URL(c.url).hostname.replace('www.', '');
    } catch {
      return c.url;
    }
  });
  
  const uniqueDomains = new Set(domains);
  const domainTypes = {
    educational: domains.filter(d => d.includes('.edu')).length,
    government: domains.filter(d => d.includes('.gov')).length,
    commercial: domains.filter(d => d.includes('.com')).length,
    wikipedia: domains.filter(d => d.includes('wikipedia')).length,
    other: domains.filter(d => !d.includes('.edu') && !d.includes('.gov') && !d.includes('.com') && !d.includes('wikipedia')).length
  };
  
  return {
    totalDomains: uniqueDomains.size,
    domainTypes,
    diversityScore: Math.round((uniqueDomains.size / citations.length) * 100)
  };
}

// Perplexity Citations component
function PerplexityCitations({ data }: { data: PerplexityData }) {
  const citations = extractPerplexityCitations(data.response || '', data);
  const diversity = citations.length > 0 ? analyzeCitationDiversity(citations) : null;
  
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-2">
          <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
          <span className="text-sm font-semibold text-purple-700">Sources & Citations ({citations.length})</span>
        </div>
      </div>
      <div className="p-6">
        {citations.length > 0 ? (
          <div className="space-y-3">
            {citations.map((citation, index) => (
              <div key={index} className={`flex items-start space-x-3 p-3 rounded-lg border ${
                citation.source === 'Google Search' 
                  ? 'bg-green-50 border-green-100' 
                  : citation.type === 'search_result'
                  ? 'bg-blue-50 border-blue-100'
                  : 'bg-purple-50 border-purple-100'
              }`}>
                <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                  citation.source === 'Google Search' 
                    ? 'bg-green-100' 
                    : citation.type === 'search_result'
                    ? 'bg-blue-100'
                    : 'bg-purple-100'
                }`}>
                  <span className={`text-xs font-bold ${
                    citation.source === 'Google Search' 
                      ? 'text-green-700' 
                      : citation.type === 'search_result'
                      ? 'text-blue-700'
                      : 'text-purple-700'
                  }`}>{index + 1}</span>
                </div>
                <div className="flex-shrink-0">
                  {citation.source === 'Google Search' ? (
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                    </svg>
                  ) : (
                    citation.url && <WebLogo domain={citation.url} className="w-[18px] h-[18px]" size={18} />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <a 
                    href={citation.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className={`font-medium text-sm block truncate ${
                      citation.source === 'Google Search' 
                        ? 'text-green-600 hover:text-green-800' 
                        : citation.type === 'search_result'
                        ? 'text-blue-600 hover:text-blue-800'
                        : 'text-purple-600 hover:text-purple-800'
                    }`}
                    title={citation.text}
                  >
                    {citation.text}
                  </a>
                  <p className="text-xs text-gray-500 mt-1 truncate">{citation.url}</p>
                  {citation.source && (
                    <div className="flex items-center space-x-2 mt-1">
                      <p className={`text-xs ${
                        citation.source === 'Google Search' 
                          ? 'text-green-600' 
                          : citation.type === 'search_result'
                          ? 'text-blue-600'
                          : 'text-purple-600'
                      }`}>Source: {citation.source}</p>
                      {citation.type && (
                        <span className={`px-1 py-0.5 rounded text-xs ${
                          citation.type === 'structured' 
                            ? 'bg-purple-100 text-purple-700'
                            : citation.type === 'search_result'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {citation.type.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8">
            <div className="w-12 h-12 mx-auto mb-4 bg-purple-100 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16l4-2 4 2 4-2 4 2V4l-4 2-4-2-4 2-4-2z" />
              </svg>
            </div>
            <h3 className="text-sm font-medium text-gray-900 mb-2">No Citations Found</h3>
            <p className="text-xs text-gray-600">No citations were found in the response content</p>
            
            {/* Debug information */}
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-left">
              <p className="text-xs font-medium text-yellow-800 mb-2">Debug Info:</p>
              <div className="text-xs text-yellow-700 space-y-1">
                <p>Response length: {data.response?.length || 0}</p>
                <p>Citations data: {data.citationsData || 'None'}</p>
                <p>Search results data: {data.searchResultsData || 'None'}</p>
                <p>Structured citations data: {data.structuredCitationsData || 'None'}</p>
                <p>Citations count: {data.citationsCount || 0}</p>
                <p>Search results count: {data.searchResultsCount || 0}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Main Perplexity Response Renderer component
export default function PerplexityResponseRenderer({ data, activeTab = 'response' }: PerplexityResponseRendererProps) {
  if (!data) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
          <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-8 h-8 text-gray-400" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
          </svg>
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-2">Perplexity AI Not Available</h3>
        <p className="text-gray-600">Perplexity AI is not included in the basic plan.</p>
      </div>
    );
  }

  if (activeTab === 'citations') {
    return <PerplexityCitations data={data} />;
  }

  // Response tab
  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="px-6 py-4 border-b border-gray-100">
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            <span className="text-sm font-semibold text-gray-700">AI Response</span>
          </div>
          {data.realTimeData && (
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">Real-time Data</span>
            </div>
          )}
          {data.responseTime && (
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">{data.responseTime}ms</span>
            </div>
          )}
        </div>
      </div>
      <div className="p-6">
        <div className="prose prose-purple max-w-none">
          <PerplexityMarkdownRenderer content={data.response || 'Perplexity AI is not included in the basic plan'} />
        </div>
      </div>
    </div>
  );
}

export { PerplexityMarkdownRenderer, PerplexityCitations }; 