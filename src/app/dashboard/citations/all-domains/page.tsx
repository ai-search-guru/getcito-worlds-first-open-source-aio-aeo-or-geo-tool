'use client'
import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import { useLifetimeCitations } from '@/hooks/useLifetimeCitations';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Card from '@/components/shared/Card';
// Citation extraction functions no longer needed - using lifetime data
import WebLogo from '@/components/shared/WebLogo';
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

export default function AllDomainsPage(): React.ReactElement {
  const { selectedBrand } = useBrandContext();
  const { 
    citations: lifetimeCitations, 
    loading: queriesLoading, 
    error: queriesError,
    stats: lifetimeStats
  } = useLifetimeCitations({ brandId: selectedBrand?.id });

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState('');
  const [selectedSource, setSelectedSource] = useState('');

  // Helper functions
  const getSourceType = (domain: string, isBrandDomain: boolean, isCompetitor: boolean) => {
    if (isBrandDomain) return 'Own Brand';
    if (isCompetitor) return 'Competitor';
    
    // Common third-party domains
    if (domain.includes('wikipedia')) return 'Third Party';
    if (domain.includes('reddit')) return 'Third Party';
    if (domain.includes('stackoverflow')) return 'Third Party';
    if (domain.includes('github')) return 'Third Party';
    if (domain.includes('medium')) return 'Third Party';
    if (domain.includes('forbes')) return 'Third Party';
    if (domain.includes('techcrunch')) return 'Third Party';
    
    return 'Third Party';
  };

  // Use lifetime citations from the hook
  const allCitations = useMemo(() => {
    if (!lifetimeCitations || !selectedBrand) return [];
    
    console.log('🔍 All-domains page - using lifetime citations:', {
      citationsCount: lifetimeCitations.length,
      selectedBrand: selectedBrand.companyName
    });

    return lifetimeCitations;
  }, [lifetimeCitations, selectedBrand]);

  // Filter citations
  const filteredCitations = useMemo(() => {
    return allCitations.filter(citation => {
      // Exclude Google search results for domain analysis
      if (citation.domain === 'google.com') return false;

      // Search filter
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase();
        if (!citation.domain?.toLowerCase().includes(searchLower) &&
            !citation.text.toLowerCase().includes(searchLower) &&
            !citation.query.toLowerCase().includes(searchLower)) {
          return false;
        }
      }

      // Provider filter
      if (selectedProvider && citation.provider !== selectedProvider) {
        return false;
      }

      // Source filter
      if (selectedSource) {
        const sourceType = getSourceType(citation.domain || '', citation.isDomainCitation || false, false);
        if (selectedSource === 'own' && sourceType !== 'Own Brand') return false;
        if (selectedSource === 'competitor' && sourceType !== 'Competitor') return false;
        if (selectedSource === 'third-party' && sourceType !== 'Third Party') return false;
      }

      return true;
    });
  }, [allCitations, searchTerm, selectedProvider, selectedSource]);

  // Group citations by domain and calculate stats
  const domainStats = useMemo(() => {
    const stats = new Map();
    
    filteredCitations.forEach(citation => {
      if (!stats.has(citation.domain)) {
        stats.set(citation.domain, {
          domain: citation.domain,
          citations: [],
          queries: new Set(),
          isBrandDomain: citation.isDomainCitation,
          isCompetitor: false // You can enhance this logic
        });
      }
      
      const domainStat = stats.get(citation.domain);
      domainStat.citations.push(citation);
      domainStat.queries.add(citation.queryId);
    });
    
    // Convert to array and sort by number of answers
    return Array.from(stats.values())
      .sort((a, b) => b.queries.size - a.queries.size);
  }, [filteredCitations]);

  const getProviderStats = (citations: Citation[]) => {
    return citations.reduce((acc, citation) => {
      acc[citation.provider] = (acc[citation.provider] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  };

  const handleExport = () => {
    const csvContent = [
              ['Domain', 'Source Type', 'Total Citations', 'Providers'].join(','),
      ...domainStats.map(stat => [
        stat.domain,
        getSourceType(stat.domain, stat.isBrandDomain, stat.isCompetitor),
        stat.citations.length,
        [...new Set(stat.citations.map(c => c.provider))].join(';')
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `all-domains-citations-${new Date().toISOString().split('T')[0]}.csv`;
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
            <h1 className="text-3xl font-bold text-gray-900">All Cited Domains</h1>
            <p className="mt-2 text-gray-600">
              Complete list of all domains referenced in AI answers across all providers.
            </p>
          </div>

          {/* Search and Filter Controls */}
          <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex-1">
                <input
                  type="text"
                  placeholder="Search domains by name, query, or content..."
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
                <select
                  value={selectedSource}
                  onChange={(e) => setSelectedSource(e.target.value)}
                  className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Sources</option>
                  <option value="own">Own Brand</option>
                  <option value="competitor">Competitor</option>
                  <option value="third-party">Third Party</option>
                </select>
                <button
                  onClick={handleExport}
                  disabled={domainStats.length === 0}
                  className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <Download className="h-4 w-4" />
                  <span>Export</span>
                </button>
              </div>
            </div>
            <div className="mt-4 text-sm text-gray-600">
              Showing {domainStats.length} domains
            </div>
          </div>

          {/* All Domains Table */}
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
          ) : domainStats.length === 0 ? (
            <Card className="p-6 text-center">
              <div className="w-12 h-12 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                <Search className="w-6 h-6 text-gray-400" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Domains Found</h3>
              <p className="text-gray-600">
                {allCitations.length === 0 
                  ? 'Process some queries first to generate citations data.'
                  : 'No domains match your current filters. Try adjusting your search criteria.'
                }
              </p>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="px-6 py-4 border-b border-gray-100">
                <h2 className="text-lg font-semibold text-gray-900">All Cited Domains ({domainStats.length})</h2>
                <p className="text-sm text-gray-600">Complete list of domains referenced in AI answers</p>
              </div>
              
              {/* Mobile Card Layout */}
              <div className="block lg:hidden">
                <div className="divide-y divide-gray-200">
                  {domainStats.map((domainStat, index) => {
                    const sourceType = getSourceType(domainStat.domain, domainStat.isBrandDomain, domainStat.isCompetitor);
                    const providerStats = getProviderStats(domainStat.citations);
                    
                    return (
                      <div key={domainStat.domain} className="p-4 space-y-3">
                        {/* Domain Header */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-3">
                            <WebLogo domain={`https://${domainStat.domain}`} className="w-6 h-6" size={24} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center space-x-2">
                                <span className="font-medium text-gray-900 truncate">
                                  {domainStat.domain}
                                </span>
                                <a
                                  href={`https://${domainStat.domain}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-gray-400 hover:text-gray-600 transition-colors"
                                  title={`Visit ${domainStat.domain}`}
                                >
                                  <ExternalLink className="w-4 h-4" />
                                </a>
                              </div>
                            </div>
                          </div>
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                            sourceType === 'Own Brand' ? 'bg-blue-100 text-blue-800' :
                            sourceType === 'Competitor' ? 'bg-red-100 text-red-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {sourceType}
                          </span>
                        </div>
                        
                        {/* Answer Distribution */}
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-2">
                            {domainStat.citations.length > 1 && (
                              <span className="text-lg font-bold text-gray-900">{domainStat.citations.length}</span>
                            )}
                            <span className="text-sm text-gray-600">
                              {domainStat.citations.length === 1 ? 'citation' : 'citations'}
                            </span>
                          </div>
                          <div className="flex items-center space-x-2">
                            {Object.entries(providerStats).map(([provider, count]) => (
                              <div key={provider} className="flex items-center space-x-1" title={`${provider} - ${count} citation${count > 1 ? 's' : ''}`}>
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
                                {count > 1 && <span className="text-xs font-medium text-gray-700">{count}</span>}
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
                        Cited Domain
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Source Type
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Answer Distribution
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {domainStats.map((domainStat, index) => {
                      const sourceType = getSourceType(domainStat.domain, domainStat.isBrandDomain, domainStat.isCompetitor);
                      const providerStats = getProviderStats(domainStat.citations);
                      
                      return (
                        <tr key={domainStat.domain} className="hover:bg-gray-50">
                          <td className="px-4 py-4">
                            <div className="flex items-center space-x-3">
                              <div className="flex-shrink-0">
                                <WebLogo domain={`https://${domainStat.domain}`} className="w-6 h-6" size={24} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center space-x-2">
                                  <span className="font-medium text-gray-900 truncate">
                                    {domainStat.domain}
                                  </span>
                                  <a
                                    href={`https://${domainStat.domain}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-gray-400 hover:text-gray-600 transition-colors"
                                    title={`Visit ${domainStat.domain}`}
                                  >
                                    <ExternalLink className="w-4 h-4" />
                                  </a>
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                              sourceType === 'Own Brand' ? 'bg-blue-100 text-blue-800' :
                              sourceType === 'Competitor' ? 'bg-red-100 text-red-800' :
                              'bg-gray-100 text-gray-800'
                            }`}>
                              {sourceType}
                            </span>
                          </td>
                          <td className="px-4 py-4 text-center">
                            <div className="flex items-center justify-center">
                              <div className="flex items-center space-x-3">
                                {domainStat.citations.length > 1 && (
                                  <span className="text-lg font-bold text-gray-900">{domainStat.citations.length}</span>
                                )}
                              </div>
                              <div className="flex items-center space-x-2 ml-4">
                                {Object.entries(providerStats).map(([provider, count]) => (
                                  <div key={provider} className="flex items-center space-x-1" title={`${provider} - ${count} citation${count > 1 ? 's' : ''}`}>
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
                                    {count > 1 && <span className="text-xs font-medium text-gray-700">{count}</span>}
                                  </div>
                                ))}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
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

// Helper functions no longer needed - using pre-processed lifetime citation data 