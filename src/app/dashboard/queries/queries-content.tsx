'use client'
import React, { useState } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import DashboardLayout from '@/components/layout/DashboardLayout';
import QueriesOverview from '@/components/features/QueriesOverview';
import { useAuthContext } from '@/context/AuthContext';
import { doc, updateDoc, arrayUnion, getFirestore } from 'firebase/firestore';
import firebase_app from '@/firebase/config';
import WebLogo from '@/components/shared/WebLogo';
import { ChatGPTResponse, ChatGPTCitations } from '@/components/features/ChatGPTResponseRenderer';
import { GoogleAIOverviewResponse, GoogleAIOverviewCitations } from '@/components/features/GoogleAIOverviewRenderer';
import PerplexityResponseRenderer, { extractPerplexityCitations } from '@/components/features/PerplexityResponseRenderer';
import { BrandMentionCounter, analyzeBrandMentions } from '@/components/features/BrandMentionCounter';
import { 
  Search, 
  RefreshCw,
  AlertCircle,
  X
} from 'lucide-react';

const db = getFirestore(firebase_app);

// Simple markdown renderer component
function MarkdownRenderer({ content }: { content: string }) {
  const cleanAndParseContent = (text: string) => {
    if (!text) return text;
    
    // First, clean up malformed HTML links and citations while preserving structure
    let cleaned = text;
    
    // Fix malformed source citations like (source=openai" target="_blank"...)
    cleaned = cleaned.replace(/\(source=([^"]+)"\s+target="_blank"[^>]*>([^)]+)\)/g, '[$2]($2) *(source: $1)*');
    
    // Clean up broken Google search links like "](https://www.google.com/search?sca_" and incomplete text
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*\s*[^)]*\)/g, '');
    cleaned = cleaned.replace(/\]\(https:\/\/www\.google\.com\/search\?[^)\s]*$/g, '');
    
    // Clean up broken URLs with search parameters
    cleaned = cleaned.replace(/esv=[^&\s]+&[^"\s]*/g, '');
    
    // Fix malformed links that start with parameters
    cleaned = cleaned.replace(/hl=en&gl=US[^"\s]*/g, '');
    
    // Convert numbered citations [[1]] to cleaner format
    cleaned = cleaned.replace(/\[\[(\d+)\]\]\([^)]+\)/g, '[$1]');
    
    // Clean up excessive whitespace but preserve paragraph breaks
    cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n'); // Triple+ line breaks to double
    cleaned = cleaned.replace(/[ \t]+/g, ' '); // Multiple spaces/tabs to single space
    cleaned = cleaned.replace(/[ \t]*\n[ \t]*/g, '\n'); // Clean spaces around line breaks
    
    return cleaned.trim();
  };

  const renderMarkdown = (text: string) => {
    if (!text) return text;
    
    // Clean the content first, but preserve original markdown structure
    let processed = cleanAndParseContent(text);
    
    // Debug logging to understand content structure
    console.log('🔍 Markdown Processing Debug:', {
      originalLength: text.length,
      cleanedLength: processed.length,
      hasHeaders: /^#{1,3}\s/.test(processed),
      hasParagraphs: processed.includes('\n\n'),
      preview: processed.substring(0, 300) + '...'
    });
    
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
    processed = processed.replace(/\*\(source:\s*([^)]+)\)\*/g, '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 ml-2">Source: $1</span>');
    
    // Handle links [text](url) - preserve original markdown functionality
    processed = processed.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-blue-600 hover:text-blue-800 underline font-medium">$1</a>');
    
    // Handle numbered citations [1], [2], etc. (AFTER links to avoid conflicts)
    processed = processed.replace(/\[(\d+)\](?!\()/g, '<sup class="inline-flex items-center justify-center w-5 h-5 text-xs font-bold text-white bg-blue-500 rounded-full ml-1">$1</sup>');
    
    // Handle headers (# ## ###) - preserve original markdown functionality
    // More flexible header detection that handles various formats
    processed = processed.replace(/^###\s*(.+)$/gm, '<h3 class="text-lg font-semibold text-gray-900 mt-6 mb-3 border-b border-gray-200 pb-2">$1</h3>');
    processed = processed.replace(/^##\s*(.+)$/gm, '<h2 class="text-xl font-semibold text-gray-900 mt-6 mb-3 border-b border-gray-200 pb-2">$1</h2>');
    processed = processed.replace(/^#\s*(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-4 border-b border-gray-200 pb-2">$1</h1>');
    
    // Also handle headers that might have numbers or other prefixes
    processed = processed.replace(/^###\s*\d+\.\s*(.+)$/gm, '<h3 class="text-lg font-semibold text-gray-900 mt-6 mb-3 border-b border-gray-200 pb-2">$1</h3>');
    processed = processed.replace(/^##\s*\d+\.\s*(.+)$/gm, '<h2 class="text-xl font-semibold text-gray-900 mt-6 mb-3 border-b border-gray-200 pb-2">$1</h2>');
    processed = processed.replace(/^#\s*\d+\.\s*(.+)$/gm, '<h1 class="text-2xl font-bold text-gray-900 mt-6 mb-4 border-b border-gray-200 pb-2">$1</h1>');
    
    // Handle special sections like "Free Tools:" with enhanced styling (NEW FEATURE)
    processed = processed.replace(/^(Free Tools?|Paid Tools?|Key Features?|Benefits?):\s*$/gm, '<div class="bg-gradient-to-r from-indigo-50 to-blue-50 border-l-4 border-indigo-400 p-4 my-4 rounded-r-lg"><h4 class="text-lg font-semibold text-indigo-900 mb-2">$1</h4></div>');
    
    // Handle numbered lists (1. 2. 3.) - enhanced but preserve original structure
    const lines = processed.split('\n');
    let inOrderedList = false;
    let inUnorderedList = false;
    const processedLines = lines.map(line => {
      const isNumberedBullet = /^\d+\.\s+(.+)$/.test(line.trim());
      const isUnorderedBullet = /^[-*]\s+(.+)$/.test(line.trim());
      
      if (isNumberedBullet && !inOrderedList) {
        inUnorderedList = false;
        inOrderedList = true;
        return '<ol class="list-decimal list-inside space-y-2 my-4 ml-4">\n<li class="text-gray-700 leading-relaxed">' + line.replace(/^\d+\.\s+(.+)$/, '$1') + '</li>';
      } else if (isNumberedBullet && inOrderedList) {
        return '<li class="text-gray-700 leading-relaxed">' + line.replace(/^\d+\.\s+(.+)$/, '$1') + '</li>';
      } else if (isUnorderedBullet && !inUnorderedList) {
        inOrderedList = false;
        inUnorderedList = true;
        return '<ul class="list-disc list-inside space-y-2 my-4 ml-4">\n<li class="text-gray-700 leading-relaxed">' + line.replace(/^[-*]\s+(.+)$/, '$1') + '</li>';
      } else if (isUnorderedBullet && inUnorderedList) {
        return '<li class="text-gray-700 leading-relaxed">' + line.replace(/^[-*]\s+(.+)$/, '$1') + '</li>';
      } else if (!isNumberedBullet && !isUnorderedBullet && inOrderedList) {
        inOrderedList = false;
        return '</ol>\n' + line;
      } else if (!isNumberedBullet && !isUnorderedBullet && inUnorderedList) {
        inUnorderedList = false;
        return '</ul>\n' + line;
      }
      
      return line;
    });
    
    if (inOrderedList) {
      processedLines.push('</ol>');
    }
    if (inUnorderedList) {
      processedLines.push('</ul>');
    }
    
    processed = processedLines.join('\n');
    
    // ENHANCED FEATURES (NEW) - Apply after core markdown processing
    // Handle pricing information with special styling
    processed = processed.replace(/(\$[\d,]+(?:\.\d{2})?(?:\s*per\s*month)?)/gi, '<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 mx-1">$1</span>');
    
    // Handle tool names and brand mentions with highlighting
    processed = processed.replace(/\b(SEMrush|Ahrefs|Ubersuggest|Google Analytics|Google Search Console|Surfer SEO|SEOptimer|ChatGPT|OpenAI|Gemini|Perplexity)\b/g, '<span class="font-medium text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded text-sm">$1</span>');
    
    // Handle line breaks and paragraphs - preserve original markdown functionality
    processed = processed.replace(/\n\n/g, '</p><p class="mb-4 text-gray-700 leading-relaxed">');
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

interface GeneratedQuery {
  keyword: string;
  query: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
  containsBrand: 0 | 1;
}

interface AIResponseModalProps {
  selectedQuery: any;
  onClose: () => void;
}

function AIResponseModal({ selectedQuery, onClose }: AIResponseModalProps) {
  const [activeTab, setActiveTab] = useState<'chatgpt' | 'google' | 'perplexity'>('chatgpt');
  const [activeSubTab, setActiveSubTab] = useState<'response' | 'citations'>('response');
  
  // Get available providers
  const availableProviders: ('chatgpt' | 'google' | 'perplexity')[] = [];
  if (selectedQuery.results.chatgpt) availableProviders.push('chatgpt');
  if (selectedQuery.results.googleAI) availableProviders.push('google');
  if (selectedQuery.results.perplexity) availableProviders.push('perplexity');
  
  // Get brand context for detection
  const { selectedBrand } = useBrandContext();
  const brandName = selectedBrand?.companyName || '';
  const brandDomain = selectedBrand?.website ? 
    selectedBrand.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : '';
  
  // Provider-specific citation extraction functions
  const extractChatGPTCitations = (text: string): { url: string; text: string; source?: string }[] => {
    if (!text) return [];
    
    const citations: { url: string; text: string; source?: string }[] = [];
    const seen = new Set<string>();
    
    // Helper function to normalize URLs for deduplication
    const normalizeUrl = (url: string): string => {
      try {
        const urlObj = new URL(url);
        // Remove common tracking parameters and fragments
        urlObj.searchParams.delete('utm_source');
        urlObj.searchParams.delete('utm_medium');
        urlObj.searchParams.delete('utm_campaign');
        urlObj.hash = '';
        return urlObj.toString();
      } catch {
        return url.trim();
      }
    };
    
    // Extract Google search URLs first (before they get cleaned)
    const googleSearchPattern = /https:\/\/www\.google\.com\/search\?[^\s<>"{}|\\^`[\]]+/g;
    const googleSearchUrls = text.match(googleSearchPattern) || [];
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
    while ((match = malformedSourcePattern.exec(text)) !== null) {
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
            source: isGoogleSearch ? 'Google Search' : 'ChatGPT'
          });
          seen.add(normalizedUrl);
        }
      }
    }
    
    // Extract numbered citations with URLs [[1]](url)
    const numberedCitationPattern = /\[\[(\d+)\]\]\(([^)]+)\)/g;
    while ((match = numberedCitationPattern.exec(text)) !== null) {
      const citationNumber = match[1];
      const url = match[2];
      if (url && url.trim()) {
        const normalizedUrl = normalizeUrl(url);
        if (!seen.has(normalizedUrl)) {
          const isGoogleSearch = url.includes('google.com/search?');
          
          if (isGoogleSearch) {
            citations.push({ text: 'Google Search', url: url.trim(), source: 'Google Search' });
          } else {
            // Extract domain from URL for display
            let displayText = url;
            try {
              const urlObj = new URL(url);
              displayText = urlObj.hostname.replace('www.', '');
            } catch (e) {
              displayText = url;
            }
            citations.push({ text: `Citation ${citationNumber}: ${displayText}`, url: url.trim(), source: 'ChatGPT' });
          }
          seen.add(normalizedUrl);
        }
      }
    }
    
    // Extract markdown links [text](url)
    const markdownLinks = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
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
              source: isGoogleSearch ? 'Google Search' : 'ChatGPT'
            });
            seen.add(normalizedUrl);
          }
        }
      }
    });
    
    // Extract plain URLs (but clean them first)
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];
    urls.forEach(url => {
      // Clean up URLs with search parameters
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
            citations.push({ text: displayText, url: cleanUrl.trim(), source: 'ChatGPT' });
          }
          seen.add(normalizedUrl);
        }
      }
    });
    
    // Extract domain references like (time.com), (arxiv.org), etc.
    const domainPattern = /\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
    let domainMatch;
    while ((domainMatch = domainPattern.exec(text)) !== null) {
      const domain = domainMatch[1];
      if (domain && domain.trim()) {
        const url = `https://${domain}`;
        const normalizedUrl = normalizeUrl(url);
        if (!seen.has(normalizedUrl)) {
          const isGoogleSearch = url.includes('google.com/search?');
          citations.push({ 
            text: isGoogleSearch ? 'Google Search' : domain, 
            url, 
            source: isGoogleSearch ? 'Google Search' : 'ChatGPT'
          });
          seen.add(normalizedUrl);
        }
      }
    }
    
    // Extract citations from paragraph endings - handles cases where citations appear at the end of paragraphs
    const paragraphCitationPattern = /\.\s*\(([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\)/g;
    while ((match = paragraphCitationPattern.exec(text)) !== null) {
      const domain = match[1];
      if (domain && domain.trim()) {
        const url = `https://${domain}`;
        const normalizedUrl = normalizeUrl(url);
        if (!seen.has(normalizedUrl)) {
          const isGoogleSearch = url.includes('google.com/search?');
          citations.push({ 
            text: isGoogleSearch ? 'Google Search' : domain, 
            url, 
            source: isGoogleSearch ? 'Google Search' : 'ChatGPT'
          });
          seen.add(normalizedUrl);
        }
      }
    }
    
    return citations;
  };

  const extractGoogleCitations = (text: string, googleAIData?: any): { url: string; text: string; source?: string }[] => {
    const citations: { url: string; text: string; source?: string }[] = [];
    const seen = new Set<string>();
    
    // Helper function to normalize URLs for deduplication
    const normalizeUrl = (url: string): string => {
      try {
        const urlObj = new URL(url);
        // Remove common tracking parameters and fragments
        urlObj.searchParams.delete('utm_source');
        urlObj.searchParams.delete('utm_medium');
        urlObj.searchParams.delete('utm_campaign');
        urlObj.hash = '';
        return urlObj.toString();
      } catch {
        return url.trim();
      }
    };
    
    // Extract from AI Overview references if available
    if (googleAIData?.aiOverviewReferences && Array.isArray(googleAIData.aiOverviewReferences)) {
      googleAIData.aiOverviewReferences.forEach((ref: any) => {
        if (ref.url && ref.url.trim()) {
          const normalizedUrl = normalizeUrl(ref.url);
          if (!seen.has(normalizedUrl)) {
            // Check if this is a Google search URL
            const isGoogleSearch = ref.url.includes('google.com/search?');
            
            citations.push({
              url: ref.url.trim(),
              text: isGoogleSearch ? 'Google Search' : (ref.title || ref.text || ref.domain || ref.url),
              source: isGoogleSearch ? 'Google Search' : 'AI Overview Reference'
            });
            seen.add(normalizedUrl);
          }
        }
      });
    }
    
    // Then extract from markdown content if available (only if not already found in references)
    if (text) {
    // Extract markdown links [text](url)
    const markdownLinks = text.match(/\[([^\]]+)\]\(([^)]+)\)/g) || [];
    markdownLinks.forEach(link => {
      const match = link.match(/\[([^\]]+)\]\(([^)]+)\)/);
        if (match && match[2] && match[2].trim()) {
          const normalizedUrl = normalizeUrl(match[2]);
          if (!seen.has(normalizedUrl)) {
            const isGoogleSearch = match[2].includes('google.com/search?');
            citations.push({ 
              text: isGoogleSearch ? 'Google Search' : (match[1] || match[2]), 
              url: match[2].trim(), 
              source: isGoogleSearch ? 'Google Search' : 'AI Overview Content'
            });
            seen.add(normalizedUrl);
          }
      }
    });
    
    // Extract plain URLs
    const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
    const urls = text.match(urlRegex) || [];
    urls.forEach(url => {
        if (url && url.trim()) {
          const normalizedUrl = normalizeUrl(url);
          if (!seen.has(normalizedUrl)) {
            const isGoogleSearch = url.includes('google.com/search?');
            let displayText = url;
            if (!isGoogleSearch) {
              try {
                const urlObj = new URL(url);
                displayText = urlObj.hostname.replace('www.', '');
              } catch (e) {
                displayText = url;
              }
            }
            citations.push({ 
              text: isGoogleSearch ? 'Google Search' : displayText, 
              url: url.trim(), 
              source: isGoogleSearch ? 'Google Search' : 'AI Overview Content'
            });
            seen.add(normalizedUrl);
      }
        }
      });
    }
    
    return citations;
  };



  // Extract citations for each provider using their specific extraction functions
  const chatgptCitations = selectedQuery.results.chatgpt ? 
    extractChatGPTCitations(selectedQuery.results.chatgpt.response) : [];
  const googleCitations = selectedQuery.results.googleAI ? 
    extractGoogleCitations(selectedQuery.results.googleAI.aiOverview || '', selectedQuery.results.googleAI) : [];
  const perplexityCitations = selectedQuery.results.perplexity ? 
    extractPerplexityCitations(selectedQuery.results.perplexity.response, selectedQuery.results.perplexity) : [];

  // Create unified brand analysis using the new analyzer with pre-extracted citations
  const brandAnalysis = analyzeBrandMentions(brandName, brandDomain, {
    chatgpt: selectedQuery.results.chatgpt ? {
      response: selectedQuery.results.chatgpt.response,
      citations: chatgptCitations
    } : undefined,
    googleAI: selectedQuery.results.googleAI ? {
      aiOverview: selectedQuery.results.googleAI.aiOverview,
      citations: googleCitations
    } : undefined,
    perplexity: selectedQuery.results.perplexity ? {
      response: selectedQuery.results.perplexity.response,
      citations: perplexityCitations
    } : undefined
  }, selectedBrand?.competitors || []);

  // Function to get citation counts for each provider - use the same citations from brand analysis
  const getCitationCounts = () => {
    return {
      chatgpt: brandAnalysis.results.chatgpt?.citationCount || 0,
      google: brandAnalysis.results.google?.citationCount || 0,
      perplexity: brandAnalysis.results.perplexity?.citationCount || 0
    };
  };
  
  const citationCounts = getCitationCounts();
  
  // Set default active tab to first available provider
  React.useEffect(() => {
    if (availableProviders.length > 0) {
      setActiveTab(availableProviders[0] as 'chatgpt' | 'google' | 'perplexity');
    }
  }, [selectedQuery]);

  // Reset sub-tab when switching main tabs
  React.useEffect(() => {
    setActiveSubTab('response');
  }, [activeTab]);

  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case 'chatgpt':
        return (
          <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-5 h-5 text-foreground transition-all duration-200" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
          </svg>
        );
      case 'google':
        return (
          <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-5 h-5 transition-all duration-200" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
            <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657
	C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
            <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
            <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
          </svg>
        );
      case 'perplexity':
        return (
          <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-5 h-5 text-foreground transition-all duration-200" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
            <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
          </svg>
        );
      default:
        return '🤖';
    }
  };

  const getProviderName = (provider: string) => {
    switch (provider) {
      case 'chatgpt':
        return 'ChatGPT';
      case 'google':
        return 'Google AIO';
      case 'perplexity':
        return 'Perplexity';
      default:
        return provider;
    }
  };

  const getProviderColor = (provider: string) => {
    switch (provider) {
      case 'chatgpt':
        return 'bg-green-500';
      case 'google':
        return 'bg-blue-500';
      case 'perplexity':
        return 'bg-purple-500';
      default:
        return 'bg-gray-500';
    }
  };

  const renderContent = () => {
    const renderSubTabs = () => (
      <div className="border-b border-gray-100 mb-6">
        <div className="flex space-x-0">
          <button
            onClick={() => setActiveSubTab('response')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === 'response'
                ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Response
          </button>
          <button
            onClick={() => setActiveSubTab('citations')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeSubTab === 'citations'
                ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            Citations ({citationCounts[activeTab]})
          </button>
        </div>
      </div>
    );

    const renderChatGPTResponse = () => (
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-4 border-b border-gray-100">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">Response Content</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">Web Search Enabled</span>
            </div>
          </div>
        </div>
        <div className="p-6">
          <div className="prose prose-gray max-w-none">
            <MarkdownRenderer content={selectedQuery.results.chatgpt.response || 'No response available'} />
          </div>
        </div>
      </div>
    );

    const renderChatGPTCitations = () => {
      const links = brandAnalysis.results.chatgpt?.citations || [];
      
      return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">Web References ({links.length})</span>
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
                <p className="text-xs text-gray-600">No web references were found in the response content</p>
              </div>
            )}
          </div>
        </div>
      );
    };

    const renderGoogleResponse = () => {
      // Check for AI Overview presence in multiple ways
      const hasAIOverview = selectedQuery.results.googleAI.hasAIOverview || 
                           selectedQuery.results.googleAI.aiOverview || 
                           (selectedQuery.results.googleAI.aiOverviewItems && selectedQuery.results.googleAI.aiOverviewItems.length > 0);
      
      return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          {hasAIOverview ? (
            <div className="p-6">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm font-semibold text-green-700">AI Overview Invoked</span>
              </div>
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-l-4 border-green-400 p-4 rounded-lg mb-4">
                <div className="flex items-center space-x-2 mb-2">
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-sm font-medium text-green-800">Google's AI Overview was triggered for this search query</span>
                </div>
                <p className="text-green-700 text-xs">
                  This indicates that Google determined the query would benefit from an AI-generated summary.
                </p>
              </div>
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-l-4 border-blue-400 p-4 rounded-lg">
                <MarkdownRenderer content={selectedQuery.results.googleAI.aiOverview || 'AI Overview content not available'} />
              </div>
            </div>
          ) : (
            <div className="p-6">
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
                <span className="text-sm font-semibold text-orange-700">AI Overview Not Invoked</span>
              </div>
              <div className="bg-gradient-to-r from-orange-50 to-red-50 border-l-4 border-orange-400 p-4 rounded-lg mb-4">
                <div className="flex items-center space-x-2 mb-2">
                  <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                  </svg>
                  <span className="text-sm font-medium text-orange-800">Google's AI Overview was not triggered for this query</span>
                </div>
                <p className="text-orange-800 text-sm mb-3">
                  This could be because:
                </p>
                <ul className="text-orange-700 text-sm ml-4 list-disc space-y-1">
                  <li>The query doesn't meet Google's AI Overview criteria</li>
                  <li>AI Overview is not available for this search location</li>
                  <li>The query type doesn't trigger AI-generated responses</li>
                  <li>Google determined traditional search results are more appropriate</li>
                </ul>
              </div>
              <div className="flex items-center space-x-2 mb-4">
                <div className="w-2 h-2 bg-gray-500 rounded-full"></div>
                <span className="text-sm font-semibold text-gray-700">Search Results Summary</span>
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-4 rounded-lg border border-blue-200">
                  <div className="text-2xl font-bold text-blue-700">{selectedQuery.results.googleAI.totalItems || 0}</div>
                  <div className="text-sm text-blue-600 font-medium">Total Results</div>
                </div>
                <div className="bg-gradient-to-br from-green-50 to-green-100 p-4 rounded-lg border border-green-200">
                  <div className="text-2xl font-bold text-green-700">{selectedQuery.results.googleAI.organicResultsCount || selectedQuery.results.googleAI.organicResults?.length || 0}</div>
                  <div className="text-sm text-green-600 font-medium">Organic Results</div>
                </div>
                <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-4 rounded-lg border border-purple-200">
                  <div className="text-2xl font-bold text-purple-700">{selectedQuery.results.googleAI.peopleAlsoAskCount || selectedQuery.results.googleAI.peopleAlsoAsk?.length || 0}</div>
                  <div className="text-sm text-purple-600 font-medium">People Also Ask</div>
                </div>
                <div className="bg-gradient-to-br from-gray-50 to-gray-100 p-4 rounded-lg border border-gray-200">
                  <div className="text-lg font-bold text-gray-700">{selectedQuery.results.googleAI.location || 'Global'}</div>
                  <div className="text-sm text-gray-600 font-medium">Location</div>
                </div>
              </div>
            </div>
          )}
        </div>
      );
    };

    const renderGoogleCitations = () => {
      const links = brandAnalysis.results.google?.citations || [];
      
      return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 bg-indigo-500 rounded-full"></div>
              <span className="text-sm font-semibold text-gray-700">Sources & Links ({links.length})</span>
            </div>
          </div>
          <div className="p-6">
            {links.length > 0 ? (
              <div className="space-y-3">
                {links.map((link, index) => (
                  <div key={index} className={`flex items-start space-x-3 p-3 rounded-lg border ${
                    link.source === 'Google Search' 
                      ? 'bg-green-50 border-green-100' 
                      : 'bg-indigo-50 border-indigo-100'
                  }`}>
                    <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                      link.source === 'Google Search' 
                        ? 'bg-green-100' 
                        : 'bg-indigo-100'
                    }`}>
                      <span className={`text-xs font-bold ${
                        link.source === 'Google Search' 
                          ? 'text-green-700' 
                          : 'text-indigo-700'
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
                            : 'text-indigo-600 hover:text-indigo-800'
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
                            : 'text-indigo-600'
                        }`}>Source: {link.source}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div>
                {selectedQuery.results.googleAI.serpFeatures && selectedQuery.results.googleAI.serpFeatures.length > 0 ? (
                  <div>
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">SERP Features</h4>
                    <div className="flex flex-wrap gap-2 mb-6">
                      {selectedQuery.results.googleAI.serpFeatures.map((feature: string, index: number) => (
                        <span key={index} className="px-3 py-1 bg-indigo-100 text-indigo-700 rounded-full text-sm font-medium">
                          {feature}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                <div className="text-center py-8">
                  <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                    </svg>
                  </div>
                  <h3 className="text-sm font-medium text-gray-900 mb-2">No Links Found</h3>
                  <p className="text-xs text-gray-600">No web references were found in the AI Overview content</p>
                </div>
              </div>
            )}
          </div>
        </div>
      );
    };



    switch (activeTab) {
      case 'chatgpt':
        return selectedQuery.results.chatgpt ? (
          <div className="space-y-6">
            <div className="flex items-center space-x-3 mb-6">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-8 h-8 text-gray-700" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
              </svg>
              <div>
                <h3 className="text-xl font-bold text-gray-900">ChatGPT Search</h3>
                <p className="text-sm text-gray-600">AI-powered search with web access</p>
              </div>
              <div className="flex items-center space-x-2 ml-auto">
                {brandAnalysis.results.chatgpt?.brandMentioned && (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Brand Mentioned
                </span>
                )}
                {brandAnalysis.results.chatgpt?.domainCited && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    Link Cited
                </span>
                )}
                {brandAnalysis.results.chatgpt?.competitorMentioned && (
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                    Competitor Mentioned
                  </span>
                )}
              </div>
            </div>
            
            {renderSubTabs()}
            {activeSubTab === 'response' ? 
              <ChatGPTResponse response={selectedQuery.results.chatgpt.response} /> : 
              <ChatGPTCitations response={selectedQuery.results.chatgpt.response} />
            }
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-8 h-8 text-gray-400" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No ChatGPT Search Data</h3>
            <p className="text-gray-600">This query hasn't been processed with ChatGPT Search yet.</p>
          </div>
        );

      case 'google':
        return selectedQuery.results.googleAI ? (
          <div className="space-y-6">
            <div className="flex items-center space-x-3 mb-6">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-8 h-8" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657
	C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
              </svg>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Google AI Overview</h3>
                <p className="text-sm text-gray-600">Search results with AI-powered insights</p>
              </div>
              <div className="flex items-center space-x-2 ml-auto">
                {brandAnalysis.results.google?.brandMentioned && (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Brand Mentioned
                </span>
                )}
                {brandAnalysis.results.google?.domainCited && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    Link Cited
                </span>
                )}
                {brandAnalysis.results.google?.competitorMentioned && (
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                    Competitor Mentioned
                  </span>
                )}
              </div>
            </div>
            
            {renderSubTabs()}
            {activeSubTab === 'response' ? 
              <GoogleAIOverviewResponse googleAIData={selectedQuery.results.googleAI} /> : 
              <GoogleAIOverviewCitations googleAIData={selectedQuery.results.googleAI} />
            }
          </div>
        ) : (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-8 h-8" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                <path fill="#9CA3AF" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Google AI Overview Data</h3>
            <p className="text-gray-600">This query hasn't been processed with Google AI Overview yet.</p>
          </div>
        );

      case 'perplexity':
        return selectedQuery.results.perplexity ? (
          <div className="space-y-6">
            <div className="flex items-center space-x-3 mb-6">
              <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-8 h-8 text-gray-700" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
              </svg>
              <div>
                <h3 className="text-xl font-bold text-gray-900">Perplexity AI</h3>
                <p className="text-sm text-gray-600">Real-time AI search with citations</p>
              </div>
              <div className="flex items-center space-x-2 ml-auto">
                {brandAnalysis.results.perplexity?.brandMentioned && (
                <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                    Brand Mentioned
                </span>
                )}
                                {brandAnalysis.results.perplexity?.domainCited && (
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-medium">
                    Link Cited
                </span>
                )}
                {brandAnalysis.results.perplexity?.competitorMentioned && (
                  <span className="px-3 py-1 bg-amber-100 text-amber-700 rounded-full text-xs font-medium">
                    Competitor Mentioned
                  </span>
                )}
              </div>
            </div>
            
            {renderSubTabs()}
            <PerplexityResponseRenderer 
              data={selectedQuery.results.perplexity} 
              activeTab={activeSubTab} 
            />
          </div>
        ) : (
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

      default:
        return (
          <div className="text-center py-12">
            <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
              <span className="text-2xl">🤖</span>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">No Data Available</h3>
            <p className="text-gray-600">Please select a provider to view results.</p>
          </div>
        );
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-gray-50 to-white">
          <div className="flex items-center justify-between">
            <div className="flex-1">
              <h2 className="text-2xl font-bold text-gray-900 mb-1 line-clamp-2">
                "{selectedQuery.query}"
              </h2>
              <p className="text-sm text-gray-600">
                AI Platform Responses
              </p>
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-2 rounded-full hover:bg-gray-100 transition-colors duration-200 group"
            >
              <X className="h-5 w-5 text-gray-400 group-hover:text-gray-600" />
            </button>
          </div>
        </div>

        {/* Brand Mention & Citation Analysis Section */}
        <div className="px-6 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-b border-gray-100">
          <div className="flex items-center space-x-2 mb-3">
            <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
            <span className="text-sm font-semibold text-gray-700">Brand Mention & Citation Analysis</span>
          </div>
          
          {/* Summary Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-3 rounded-lg border border-blue-200">
              <div className="text-xl font-bold text-blue-700">{brandAnalysis.totals.totalBrandMentions}</div>
              <div className="text-xs text-blue-600 font-medium">Brand Mentions</div>
            </div>
            <div className="bg-gradient-to-br from-green-50 to-green-100 p-3 rounded-lg border border-green-200">
              <div className="text-xl font-bold text-green-700">{brandAnalysis.totals.totalDomainCitations}</div>
              <div className="text-xs text-green-600 font-medium">Domain Citations</div>
            </div>
            <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-3 rounded-lg border border-purple-200">
              <div className="text-xl font-bold text-purple-700">{brandAnalysis.totals.totalCitations}</div>
              <div className="text-xs text-purple-600 font-medium">Total Citations</div>
            </div>
            <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-3 rounded-lg border border-orange-200">
              <div className="text-xl font-bold text-orange-700">{brandAnalysis.totals.providersWithBrandMention}/{Object.keys(brandAnalysis.results).length}</div>
              <div className="text-xs text-orange-600 font-medium">Providers w/ Brand</div>
            </div>
          </div>

          {/* Provider Status Row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-6">
              {/* ChatGPT Status */}
              {brandAnalysis.results.chatgpt && (
                <div className="flex items-center space-x-2">
                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className={`w-5 h-5 ${brandAnalysis.results.chatgpt.brandMentioned ? 'text-green-600' : 'text-gray-400'}`} height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
                  </svg>
                  <span className="text-sm font-medium text-gray-700">ChatGPT</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.chatgpt.brandMentioned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.chatgpt.brandMentioned ? 'Brand: ✓' : 'Brand: X'}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.chatgpt.domainCited ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.chatgpt.domainCited ? 'Domain: ✓' : 'Domain: X'}
                  </span>
                </div>
              )}

              {/* Google AI Status */}
              {brandAnalysis.results.google && (
                <div className="flex items-center space-x-2">
                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className={`w-5 h-5 ${brandAnalysis.results.google.brandMentioned ? 'text-green-600' : 'text-gray-400'}`} height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#FFC107" d="M43.611,20.083H42V20H24v8h11.303c-1.649,4.657-6.08,8-11.303,8c-6.627,0-12-5.373-12-12
	c0-6.627,5.373-12,12-12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657C34.046,6.053,29.268,4,24,4C12.955,4,4,12.955,4,24
	c0,11.045,8.955,20,20,20c11.045,0,20-8.955,20-20C44,22.659,43.862,21.35,43.611,20.083z"></path>
                    <path fill="#FF3D00" d="M6.306,14.691l6.571,4.819C14.655,15.108,18.961,12,24,12c3.059,0,5.842,1.154,7.961,3.039l5.657-5.657
	C34.046,6.053,29.268,4,24,4C16.318,4,9.656,8.337,6.306,14.691z"></path>
                    <path fill="#4CAF50" d="M24,44c5.166,0,9.86-1.977,13.409-5.192l-6.19-5.238C29.211,35.091,26.715,36,24,36
	c-5.202,0-9.619-3.317-11.283-7.946l-6.522,5.025C9.505,39.556,16.227,44,24,44z"></path>
                    <path fill="#1976D2" d="M43.611,20.083H42V20H24v8h11.303c-0.792,2.237-2.231,4.166-4.087,5.571
	c0.001-0.001,0.002-0.001,0.003-0.002l6.19,5.238C36.971,39.205,44,34,44,24C44,22.659,43.862,21.35,43.611,20.083z"></path>
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Google AIO</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.google.brandMentioned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.google.brandMentioned ? 'Brand: ✓' : 'Brand: X'}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.google.domainCited ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.google.domainCited ? 'Domain: ✓' : 'Domain: X'}
                  </span>
                </div>
              )}

              {/* Perplexity Status */}
              {brandAnalysis.results.perplexity && (
                <div className="flex items-center space-x-2">
                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className={`w-5 h-5 ${brandAnalysis.results.perplexity.brandMentioned ? 'text-green-600' : 'text-gray-400'}`} height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                    <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
                  </svg>
                  <span className="text-sm font-medium text-gray-700">Perplexity</span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.perplexity.brandMentioned ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.perplexity.brandMentioned ? 'Brand: ✓' : 'Brand: X'}
                  </span>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${brandAnalysis.results.perplexity.domainCited ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-600'}`}>
                    {brandAnalysis.results.perplexity.domainCited ? 'Domain: ✓' : 'Domain: X'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Provider Tabs */}
        <div className="border-b border-gray-100 bg-white">
          <div className="flex">
            {availableProviders.map((provider) => (
              <button
                key={provider}
                onClick={() => setActiveTab(provider as 'chatgpt' | 'google' | 'perplexity')}
                className={`flex items-center space-x-3 px-8 py-4 text-sm font-medium border-b-2 transition-all duration-200 ${
                  activeTab === provider
                    ? 'border-blue-500 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                <span className="flex-shrink-0">{getProviderIcon(provider)}</span>
                <span className="font-semibold">{getProviderName(provider)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="p-8 overflow-y-auto max-h-[calc(90vh-400px)] bg-gray-50/30">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}

export default function QueriesContent(): React.ReactElement {
  const { selectedBrand, brands, loading: brandLoading, refetchBrands } = useBrandContext();
  const { user } = useAuthContext();
  const [showResults, setShowResults] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<any>(null);
  
  
  // Add Query Modal State
  const [showAddQueryModal, setShowAddQueryModal] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'Awareness' | 'Interest' | 'Consideration' | 'Purchase'>('Awareness');
  const [isSaving, setIsSaving] = useState(false);

  // Add Query Modal Handlers
  const handleAddQuery = () => {
    setShowAddQueryModal(true);
  };

  const handleSaveQuery = async () => {
    if (!newQuery.trim() || !selectedBrand || !user) {
      console.error('Missing required data for saving query');
      return;
    }

    setIsSaving(true);

    try {
      const newQueryObject = {
        keyword: 'custom',
        query: newQuery.trim(),
        category: selectedCategory,
        containsBrand: newQuery.toLowerCase().includes(selectedBrand.companyName?.toLowerCase() || '') ? 1 : 0,
        selected: true
      };
      
      console.log('💾 Saving new query to Firestore:', newQueryObject);
      
      // Update the brand document in Firestore
      const brandRef = doc(db, 'v8userbrands', selectedBrand.id);
      await updateDoc(brandRef, {
        queries: arrayUnion(newQueryObject),
        updatedAt: new Date().toISOString(),
        totalQueries: (selectedBrand.queries?.length || 0) + 1
      });

      console.log('✅ Query saved successfully to brand:', selectedBrand.id);
      
      // Reset form and close modal
      setNewQuery('');
      setSelectedCategory('Awareness');
      setShowAddQueryModal(false);
      
      // Refresh the brand context to show the new query
      await refetchBrands();
      
      // Show success message
      alert('Query added successfully!');
      
    } catch (error) {
      console.error('❌ Error saving query:', error);
      alert('Failed to save query. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancelQuery = () => {
    setNewQuery('');
    setSelectedCategory('Awareness');
    setShowAddQueryModal(false);
  };

  const handleQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newQuery.trim()) {
      handleSaveQuery();
    } else if (e.key === 'Escape') {
      handleCancelQuery();
    }
  };

  // Show loading while brands are being fetched
  if (brandLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center py-12">
          <div className="flex items-center space-x-2 text-muted-foreground">
            <RefreshCw className="h-5 w-5 animate-spin" />
            <span>Loading brands...</span>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Show empty state if no brands
  if (brands.length === 0) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <Search className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brands Found</h3>
          <p className="text-muted-foreground mb-4">
            Add your first brand to start tracking queries.
          </p>
          <Link href="/dashboard/add-brand/step-1" className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors">
            Add Brand
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  // Show message if no brand is selected
  if (!selectedBrand) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brand Selected</h3>
          <p className="text-muted-foreground">
            Please select a brand from the sidebar to view queries.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <WebLogo domain={selectedBrand.domain} size={40} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Queries</h1>
              <p className="text-muted-foreground">for {selectedBrand.companyName}</p>
              <div className="flex items-center space-x-2 mt-2">
                <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                <span className="text-sm text-blue-600 font-medium">Based on Latest Performance Data</span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <button 
              onClick={handleAddQuery}
              className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors"
            >
              Add Query
            </button>
          </div>
        </div>

        {/* Data Source Info Banner */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-blue-500 rounded-full"></div>
            <div>
              <h3 className="font-semibold text-blue-900">Latest Performance Data</h3>
              <p className="text-sm text-blue-700">
                Query data is sourced from your most recent processing session, providing up-to-date insights into current AI response patterns.
              </p>
            </div>
          </div>
        </div>

        {/* Reusable Queries Component */}
        <QueriesOverview 
          variant="full"
          layout="table"
          showSearch={false} // Temporarily commented out search functionality
          showProcessButton={true}
          showEyeIcons={true}
          onQueryClick={(query, result) => {
            if (result) {
              setSelectedQuery(result);
              setShowResults(true);
            }
          }}
          className="min-h-[400px]"
        />

        {/* AI Response Modal */}
        {showResults && selectedQuery && (
          <AIResponseModal 
            selectedQuery={selectedQuery}
            onClose={() => {
              setShowResults(false);
              setSelectedQuery(null);
            }}
          />
        )}

        {/* Add Query Modal */}
        {showAddQueryModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-lg mx-4 shadow-xl">
              {/* Modal Header */}
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-foreground">Add New Query</h3>
                <button
                  onClick={handleCancelQuery}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Modal Content */}
              <div className="space-y-6">
                <p className="text-muted-foreground text-sm">
                  Add a new query to your list for tracking and analysis.
                </p>

                {/* Query Input */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Query
                  </label>
                  <input
                    type="text"
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    onKeyDown={handleQueryKeyDown}
                    placeholder="e.g. what is the best tool for GEO? FYI it's AI Monitor 😊"
                    className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000C60] focus:border-transparent bg-background text-foreground"
                    autoFocus
                  />
                </div>

                {/* Category Selection */}
                <div>
                  <label className="block text-sm font-medium text-foreground mb-3">
                    Category
                  </label>
                  <div className="space-y-3">
                    {/* Awareness */}
                    <div 
                      onClick={() => setSelectedCategory('Awareness')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Awareness' 
                          ? 'border-blue-300 bg-blue-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-blue-500"></div>
                            <span className="font-medium text-foreground">Awareness</span>
                            {selectedCategory === 'Awareness' && (
                              <span className="bg-blue-600 text-white text-xs px-2 py-1 rounded-full">
                                AI Suggestion
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Brand discovery, "What is [brand]?", company mentions
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Interest */}
                    <div 
                      onClick={() => setSelectedCategory('Interest')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Interest' 
                          ? 'border-purple-300 bg-purple-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-purple-500"></div>
                            <span className="font-medium text-foreground">Interest</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Product features, comparisons, "How does it work?"
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Consideration */}
                    <div 
                      onClick={() => setSelectedCategory('Consideration')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Consideration' 
                          ? 'border-pink-300 bg-pink-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-pink-500"></div>
                            <span className="font-medium text-foreground">Consideration</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Evaluating options, comparisons, reviews, decision-making
                          </p>
                        </div>
                      </div>
                    </div>

                    {/* Purchase */}
                    <div 
                      onClick={() => setSelectedCategory('Purchase')}
                      className={`p-4 rounded-lg border cursor-pointer transition-colors ${
                        selectedCategory === 'Purchase' 
                          ? 'border-orange-300 bg-orange-50' 
                          : 'border-border hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="flex items-center space-x-2">
                            <div className="w-3 h-3 rounded bg-orange-500"></div>
                            <span className="font-medium text-foreground">Purchase</span>
                          </div>
                          <p className="text-sm text-muted-foreground mt-1">
                            Pricing, "Where to buy?", purchase decisions
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-end space-x-3 mt-6">
                <button
                  onClick={handleCancelQuery}
                  className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveQuery}
                  disabled={!newQuery.trim() || isSaving}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? 'Adding...' : 'Add Query'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
} 