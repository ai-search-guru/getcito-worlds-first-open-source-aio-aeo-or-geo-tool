'use client'
import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import { useBrandQueries } from '@/hooks/useBrandQueries';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Card from '@/components/shared/Card';
import { extractChatGPTCitations } from '@/components/features/ChatGPTResponseRenderer';
import { extractGoogleAIOverviewCitations } from '@/components/features/GoogleAIOverviewRenderer';
import { extractPerplexityCitations } from '@/components/features/PerplexityResponseRenderer';
import { 
  ArrowLeft,
  ExternalLink, 
  Search, 
  Filter,
  Download,
  RefreshCw,
  AlertCircle
} from 'lucide-react';

// Citation interface
interface Citation {
  id: string;
  url: string;
  text: string;
  source: string;
  provider: 'chatgpt' | 'perplexity' | 'googleAI';
  query: string;
  queryId: string;
  brandName: string;
  domain?: string;
  timestamp: string;
  type?: string;
  isBrandMention?: boolean;
  isDomainCitation?: boolean;
}

export default function AllSearchesPage(): React.ReactElement {
  const { selectedBrand } = useBrandContext();
  const { 
    queries, 
    loading: queriesLoading, 
    error: queriesError 
  } = useBrandQueries({ brandId: selectedBrand?.id });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');

  // Helper function
  const extractSearchQuery = (url: string): string => {
    try {
      const urlObj = new URL(url);
      const q = urlObj.searchParams.get('q');
      return q || 'Google Search';
    } catch {
      return 'Google Search';
    }
  };

  // Extract all citations from queries
  const allCitations = useMemo(() => {
    if (!queries || !Array.isArray(queries)) return [];

    const citations: Citation[] = [];
    
    queries.forEach((query: any) => {
      if (!query.results) return;
      
      // Extract ChatGPT citations
      if (query.results?.chatgpt?.response) {
        const chatgptCitations = extractChatGPTCitations(query.results.chatgpt.response);
        chatgptCitations.forEach((citation, index) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

          citations.push({
            id: `${query.id}-chatgpt-${index}`,
            url: citation.url,
            text: citation.text,
            source: citation.source || 'ChatGPT',
            provider: 'chatgpt' as 'chatgpt' | 'perplexity' | 'googleAI',
            query: query.query,
            queryId: query.id,
            brandName: selectedBrand?.name || '',
            domain,
            timestamp: query.timestamp || new Date().toISOString(),
            isBrandMention: checkBrandMention(citation.text, citation.url, selectedBrand?.name || '', selectedBrand?.domain),
            isDomainCitation: checkDomainCitation(citation.url, selectedBrand?.domain)
          });
        });
      }

      // Extract Google AI citations
      if (query.results?.googleAI?.aiOverview) {
        const googleCitations = extractGoogleAIOverviewCitations(query.results.googleAI.aiOverview, query.results.googleAI);
        googleCitations.forEach((citation, index) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

          citations.push({
            id: `${query.id}-googleAI-${index}`,
            url: citation.url,
            text: citation.text,
            source: citation.source || 'Google AI',
            provider: 'googleAI' as 'chatgpt' | 'perplexity' | 'googleAI',
            query: query.query,
            queryId: query.id,
            brandName: selectedBrand?.name || '',
            domain,
            timestamp: query.timestamp || new Date().toISOString(),
            isBrandMention: checkBrandMention(citation.text, citation.url, selectedBrand?.name || '', selectedBrand?.domain),
            isDomainCitation: checkDomainCitation(citation.url, selectedBrand?.domain)
          });
        });
      }

      // Extract Perplexity citations
      if (query.results?.perplexity?.response) {
        const perplexityCitations = extractPerplexityCitations(query.results.perplexity.response);
        perplexityCitations.forEach((citation, index) => {
          const domain = extractDomainFromUrl(citation.url);
          if (!domain) return;

          citations.push({
            id: `${query.id}-perplexity-${index}`,
            url: citation.url,
            text: citation.text,
            source: citation.source || 'Perplexity',
            provider: 'perplexity' as 'chatgpt' | 'perplexity' | 'googleAI',
            query: query.query,
            queryId: query.id,
            brandName: selectedBrand?.name || '',
            domain,
            timestamp: query.timestamp || new Date().toISOString(),
            isBrandMention: checkBrandMention(citation.text, citation.url, selectedBrand?.name || '', selectedBrand?.domain),
            isDomainCitation: checkDomainCitation(citation.url, selectedBrand?.domain)
          });
        });
      }
    });

    return citations;
  }, [queries, selectedBrand]);

  // Filter for Google searches only
  const googleSearchCitations = useMemo(() => {
    return allCitations.filter(citation => 
      citation.domain === 'google.com' || citation.url.includes('google.com/search')
    );
  }, [allCitations]);

  // Filter citations based on search and provider
  const filteredCitations = useMemo(() => {
    return googleSearchCitations.filter(citation => {
      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        const searchQuery = extractSearchQuery(citation.url);
        if (!searchQuery.toLowerCase().includes(searchLower) &&
            !citation.text.toLowerCase().includes(searchLower) &&
            !citation.query.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // Provider filter
      if (selectedProvider && citation.provider !== selectedProvider) {
        return false;
      }

      return true;
    });
  }, [googleSearchCitations, searchTerm, selectedProvider]);

  // Group searches by URL/query and calculate stats
  const searchStats = useMemo(() => {
    const stats = new Map();
    
    filteredCitations.forEach(citation => {
      const key = citation.text || citation.url;
      if (!stats.has(key)) {
        stats.set(key, {
          searchText: citation.text,
          url: citation.url,
          citations: [],
          queries: new Set(),
          providers: new Set()
        });
      }
      
      const searchStat = stats.get(key);
      searchStat.citations.push(citation);
      searchStat.queries.add(citation.queryId);
      searchStat.providers.add(citation.provider);
    });
    
    // Convert to array and sort by number of queries
    return Array.from(stats.values())
      .sort((a, b) => b.queries.size - a.queries.size);
  }, [filteredCitations]);

  const handleExport = () => {
    const csvContent = [
      ['Search Query', 'URL', 'Total Citations', 'Unique Queries', 'Providers'].join(','),
      ...searchStats.map(stat => [
        `"${(stat.searchText || extractSearchQuery(stat.url)).replace(/"/g, '""')}"`,
        stat.url,
        stat.citations.length,
        stat.queries.size,
        Array.from(stat.providers).join(';')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-google-searches-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <DashboardLayout>
        <div className="p-6 space-y-8">
          {/* Header */}
          <div className="flex items-center space-x-4">
            <Link 
              href="/dashboard/citations"
              className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Citations</span>
            </Link>
          </div>

          <div>
            <h1 className="text-3xl font-bold text-gray-900">All Cited Google Searches</h1>
            <p className="mt-2 text-gray-600">
              Complete list of all Google search results referenced in AI answers. These SERP pages represent SEO optimization opportunities.
            </p>
          </div>

          {/* Search and Filter Controls */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search by query text, URL, or content..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>
              <div className="flex gap-2">
                <select
                  value={selectedProvider}
                  onChange={(e) => setSelectedProvider(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Providers</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="perplexity">Perplexity</option>
                  <option value="googleAI">Google AI</option>
                </select>
                <button
                  onClick={handleExport}
                  disabled={searchStats.length === 0}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              Showing {searchStats.length} search queries from {filteredCitations.length} citations
            </div>
          </div>

          {/* All Google Searches Table */}
          {queriesLoading ? (
            <Card className="p-6">
              <div className="flex items-center space-x-2 text-gray-600">
                <RefreshCw className="h-4 w-4 animate-spin" />
                <span>Loading citations...</span>
              </div>
            </Card>
          ) : queriesError ? (
            <Card className="p-6">
              <div className="flex items-center space-x-2 text-red-600">
                <AlertCircle className="h-4 w-4" />
                <span>Error loading citations: {queriesError}</span>
              </div>
            </Card>
          ) : searchStats.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <Search className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Google Searches Found</h3>
              <p className="text-gray-600">
                {allCitations.length === 0 
                  ? 'Process some queries first to generate citations data.'
                  : 'No Google searches match your current filters. Try adjusting your search criteria.'
                }
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">All Google Searches ({searchStats.length})</h2>
                <p className="text-sm text-gray-600">Complete list of Google searches referenced in AI answers</p>
              </div>
              
              {/* Mobile Card Layout */}
              <div className="block lg:hidden">
                <div className="divide-y divide-gray-200">
                  {searchStats.map((searchStat, index) => {
                    const providerStats = getProviderStats(searchStat.citations);
                    
                    return (
                      <div key={index} className="p-4 space-y-3">
                        {/* Search Header */}
                        <div className="flex items-start space-x-3">
                          <div className="flex-shrink-0 mt-1">
                            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                            </svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-medium text-blue-600 text-sm truncate">
                                {extractSearchQuery(searchStat.text)}
                              </span>
                              <a
                                href={searchStat.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-gray-400 hover:text-gray-600 transition-colors"
                                title="View Google Search"
                              >
                                <ExternalLink className="w-4 h-4" />
                              </a>
                            </div>
                            <div className="text-xs text-gray-500 mt-1">
                              SERP Page
                            </div>
                          </div>
                        </div>
                        
                        {/* Answer Distribution */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            {searchStat.queries.size > 1 && (
                              <span className="text-lg font-bold text-gray-900">{searchStat.queries.size}</span>
                            )}
                            <span className="text-sm text-gray-600">
                              {searchStat.queries.size === 1 ? 'answer' : 'answers'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            {Array.from(searchStat.providers).map(provider => (
                              <div key={provider} className="flex items-center space-x-1" title={`${provider} citation`}>
                                {provider === 'chatgpt' && (
                                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-green-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
                                  </svg>
                                )}
                                {provider === 'perplexity' && (
                                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-purple-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
                                  </svg>
                                )}
                                {provider === 'googleAI' && (
                                  <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-4 h-4" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
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
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              
              {/* Desktop Table Layout */}
              <div className="hidden lg:block overflow-x-auto">
                <table className="w-full min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Google Search
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Answer Distribution
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {searchStats.map((searchStat, index) => (
                      <tr key={index} className="hover:bg-gray-50">
                        <td className="px-4 py-4">
                          <div className="flex items-center space-x-3">
                            <div className="flex-shrink-0">
                              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
                                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                              </svg>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-blue-600 truncate">
                                  {extractSearchQuery(searchStat.text)}
                                </span>
                                <a
                                  href={searchStat.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 hover:text-gray-600 transition-colors"
                                  title="View Google Search"
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                SERP Page
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-4 text-center">
                          <div className="flex items-center justify-center">
                            <div className="flex items-center space-x-3">
                              {searchStat.queries.size > 1 && (
                                <span className="text-lg font-bold text-gray-900">{searchStat.queries.size}</span>
                              )}
                            </div>
                            <div className="flex items-center space-x-2 ml-4">
                              {Array.from(searchStat.providers).map(provider => (
                                <div key={provider} className="flex items-center space-x-1" title={`${provider} citation`}>
                                  {provider === 'chatgpt' && (
                                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-green-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"></path>
                                    </svg>
                                  )}
                                  {provider === 'perplexity' && (
                                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" role="img" viewBox="0 0 24 24" className="w-4 h-4 text-purple-600" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
                                      <path d="M22.3977 7.0896h-2.3106V.0676l-7.5094 6.3542V.1577h-1.1554v6.1966L4.4904 0v7.0896H1.6023v10.3976h2.8882V24l6.932-6.3591v6.2005h1.1554v-6.0469l6.9318 6.1807v-6.4879h2.8882V7.0896zm-3.4657-4.531v4.531h-5.355l5.355-4.531zm-13.2862.0676 4.8691 4.4634H5.6458V2.6262zM2.7576 16.332V8.245h7.8476l-6.1149 6.1147v1.9723H2.7576zm2.8882 5.0404v-3.8852h.0001v-2.6488l5.7763-5.7764v7.0111l-5.7764 5.2993zm12.7086.0248-5.7766-5.1509V9.0618l5.7766 5.7766v6.5588zm2.8882-5.0652h-1.733v-1.9723L13.3948 8.245h7.8478v8.087z"></path>
                                    </svg>
                                  )}
                                  {provider === 'googleAI' && (
                                    <svg stroke="currentColor" fill="currentColor" strokeWidth="0" version="1.1" x="0px" y="0px" viewBox="0 0 48 48" enableBackground="new 0 0 48 48" className="w-4 h-4" height="1em" width="1em" xmlns="http://www.w3.org/2000/svg">
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
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>
      </DashboardLayout>
    </div>
  );
}

function extractDomainFromUrl(url: string): string | undefined {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace('www.', '');
  } catch {
    return undefined;
  }
}

function checkBrandMention(text: string, url: string, brandName: string, brandDomain?: string): boolean {
  if (!brandName) return false;
  
  const lowerText = text.toLowerCase();
  const lowerBrandName = brandName.toLowerCase();
  
  // Check if brand name is mentioned in the citation text
  if (lowerText.includes(lowerBrandName)) return true;
  
  // Check if the URL is from the brand's domain (check for "https://www." + domain specifically)
  if (brandDomain) {
    const lowerUrl = url.toLowerCase();
    const lowerDomain = brandDomain.toLowerCase();
    const httpsWwwDomain = `https://www.${lowerDomain}`;
    if (lowerUrl.includes(httpsWwwDomain)) return true;
  }
  
  return false;
}

function checkDomainCitation(url: string, brandDomain?: string): boolean {
  if (!brandDomain) return false;
  const lowerUrl = url.toLowerCase();
  const lowerDomain = brandDomain.toLowerCase();
  
  // Check for "https://www." + domain specifically
  const httpsWwwDomain = `https://www.${lowerDomain}`;
  return lowerUrl.includes(httpsWwwDomain);
} 