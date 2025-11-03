'use client'
import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useBrandContext } from '@/context/BrandContext';
import { useLifetimeCitations } from '@/hooks/useLifetimeCitations';
import { useBrandAnalyticsCombined } from '@/hooks/useBrandAnalytics';
import { useTotalCitations } from '@/hooks/useTotalCitations';
import DashboardLayout from '@/components/layout/DashboardLayout';
import Card from '@/components/shared/Card';
// Citation extraction functions no longer needed - using lifetime data
import WebLogo from '@/components/shared/WebLogo';
import { 
  Quote, 
  ExternalLink,
  Search, 
  Filter,
  Download,
  RefreshCw,
  AlertCircle,
  Globe,
  BarChart3,
  Calendar,
  Clock,
  Eye,
  SortAsc,
  SortDesc,
  ArrowUpDown,
  MessageSquare
} from 'lucide-react';
import CitationsTable from '@/components/features/CitationsTable';

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

// Sort options
type SortField = 'timestamp' | 'provider' | 'source' | 'domain' | 'query';
type SortDirection = 'asc' | 'desc';

// Helper function to extract search keywords from Google search URL
const extractSearchKeywords = (url: string): string => {
  try {
    const urlObj = new URL(url);
    const q = urlObj.searchParams.get('q');
    return q || 'Google Search';
  } catch {
    return 'Google Search';
  }
};

// Helper function to check if search keywords mention the brand
const searchMentionsBrand = (keywords: string, brandName: string, brandDomain?: string): boolean => {
  const keywordsLower = keywords.toLowerCase();
  const brandLower = brandName.toLowerCase();
  
  // Check if keywords contain brand name
  if (keywordsLower.includes(brandLower)) return true;
  
  // Check if keywords contain brand domain (without TLD)
  if (brandDomain) {
    const domainWithoutTld = brandDomain.split('.')[0].toLowerCase();
    if (keywordsLower.includes(domainWithoutTld)) return true;
  }
  
  return false;
};

// Helper function to generate mock SEO data
const generateMockSEOData = (keywords: string) => {
  // Generate consistent mock data based on keywords hash
  const hash = keywords.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0);
    return a & a;
  }, 0);
  
  const difficulty = Math.abs(hash % 100) + 1; // 1-100
  const volume = Math.abs(hash % 50000) + 100; // 100-50,000
  
  return { difficulty, volume };
};

// Helper functions no longer needed - using pre-processed lifetime citation data

export default function CitationsPage(): React.ReactElement {
  const { selectedBrand, brands, loading: brandLoading } = useBrandContext();
  const { 
    citations: lifetimeCitations, 
    loading: queriesLoading, 
    error: queriesError, 
    refetch,
    stats: lifetimeStats 
  } = useLifetimeCitations({ 
    brandId: selectedBrand?.id 
  });
  
  // Get analytics data to match dashboard calculations
  // This ensures domain citations count matches between dashboard and citations pages
  const { lifetimeAnalytics } = useBrandAnalyticsCombined(selectedBrand?.id);
  
  // Get total citations count using the same hook as dashboard
  const { totalCitations: totalCitationsFromHook } = useTotalCitations({ brandId: selectedBrand?.id });
  
  // State for filtering and sorting
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [selectedSource, setSelectedSource] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField>('timestamp');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showBrandMentionsOnly, setShowBrandMentionsOnly] = useState(false);

  // Use lifetime citations from the hook
  const allCitations = useMemo(() => {
    if (!lifetimeCitations || !selectedBrand) return [];
    
    console.log('🔍 Citations page - using lifetime citations:', {
      citationsCount: lifetimeCitations.length,
      selectedBrand: selectedBrand.companyName
    });

    return lifetimeCitations;
  }, [lifetimeCitations, selectedBrand]);

  // Filter and sort citations
  const filteredAndSortedCitations = useMemo(() => {
    let filtered = allCitations;

    // Apply search filter
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(citation => 
        citation.text.toLowerCase().includes(term) ||
        citation.url.toLowerCase().includes(term) ||
        citation.query.toLowerCase().includes(term) ||
        citation.source.toLowerCase().includes(term) ||
        citation.domain?.toLowerCase().includes(term)
      );
    }

    // Apply platform filter
    if (selectedProvider !== 'all') {
      filtered = filtered.filter(citation => citation.provider === selectedProvider);
    }

    // Apply source filter
    if (selectedSource !== 'all') {
      filtered = filtered.filter(citation => citation.source === selectedSource);
    }

    // Apply brand mentions filter
    if (showBrandMentionsOnly) {
      filtered = filtered.filter(citation => citation.isBrandMention || citation.isDomainCitation);
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let comparison = 0;
      
      switch (sortField) {
        case 'timestamp':
          comparison = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
          break;
        case 'provider':
          comparison = a.provider.localeCompare(b.provider);
          break;
        case 'source':
          comparison = a.source.localeCompare(b.source);
          break;
        case 'domain':
          comparison = (a.domain || '').localeCompare(b.domain || '');
          break;
        case 'query':
          comparison = a.query.localeCompare(b.query);
          break;
      }
      
      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [allCitations, searchTerm, selectedProvider, selectedSource, showBrandMentionsOnly, sortField, sortDirection]);

  // Analytics calculations
  const analytics = useMemo(() => {
    // Use all citations with valid domains (consistent with lifetime analytics calculation)
    const analyticsCitations = allCitations.filter(c => c.domain); // Only include citations with valid domains
    
    // Use actual citations array for consistent counts with table
    const totalCitations = analyticsCitations.length;
    const domainCitations = analyticsCitations.filter(c => c.isDomainCitation).length;
    const brandMentions = analyticsCitations.filter(c => c.isBrandMention).length;
    const uniqueDomains = new Set(analyticsCitations.map(c => c.domain)).size;
    
    const providerStats = {
      chatgpt: analyticsCitations.filter(c => c.provider === 'chatgpt').length,
      perplexity: analyticsCitations.filter(c => c.provider === 'perplexity').length,
      googleAI: analyticsCitations.filter(c => c.provider === 'googleAI').length
    };

    const topDomains = Object.entries(
      analyticsCitations.reduce((acc, citation) => {
        if (citation.domain) {
          acc[citation.domain] = (acc[citation.domain] || 0) + 1;
        }
        return acc;
      }, {} as Record<string, number>)
    )
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);

    const topSources = Object.entries(
      analyticsCitations.reduce((acc, citation) => {
        acc[citation.source] = (acc[citation.source] || 0) + 1;
        return acc;
      }, {} as Record<string, number>)
    )
    .sort(([,a], [,b]) => b - a)
    .slice(0, 10);

    return {
      totalCitations,
      domainCitations,
      brandMentions,
      uniqueDomains,
      providerStats,
      topDomains,
      topSources,
      domainCitationRate: totalCitations > 0 ? (domainCitations / totalCitations * 100) : 0,
      brandMentionRate: totalCitations > 0 ? (brandMentions / totalCitations * 100) : 0
    };
  }, [allCitations, lifetimeAnalytics]);

  // Handle sorting
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  // Export citations
  const handleExport = () => {
    const csvContent = [
              ['Query', 'Platform', 'Source', 'Citation Text', 'URL', 'Domain', 'Brand Mention', 'Domain Citation', 'Timestamp'].join(','),
      ...filteredAndSortedCitations.map(citation => [
        `"${citation.query.replace(/"/g, '""')}"`,
        citation.provider,
        `"${citation.source.replace(/"/g, '""')}"`,
        `"${citation.text.replace(/"/g, '""')}"`,
        citation.url,
        citation.domain || '',
        citation.isBrandMention ? 'Yes' : 'No',
        citation.isDomainCitation ? 'Yes' : 'No',
        citation.timestamp
      ].join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `citations-${selectedBrand?.companyName || 'brand'}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
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
          <Quote className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">No Brands Found</h3>
          <p className="text-muted-foreground mb-4">
            Add your first brand to start analyzing citations.
          </p>
          <Link href="/dashboard/add-brand/step-1" className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors">
            Add Brand
          </Link>
        </div>
      </DashboardLayout>
    );
  }

  // Show brand selection if no brand selected
  if (!selectedBrand) {
    return (
      <DashboardLayout>
        <div className="text-center py-12">
          <Quote className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold text-foreground mb-2">Select a Brand</h3>
          <p className="text-muted-foreground mb-4">
            Choose a brand from the sidebar to view its citations data.
          </p>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Page Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <WebLogo domain={selectedBrand.domain} size={40} />
            <div>
              <h1 className="text-2xl font-bold text-foreground">Citations Analysis</h1>
              <p className="text-muted-foreground">for {selectedBrand.companyName}</p>
              <div className="flex items-center space-x-2 mt-2">
                <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                <span className="text-sm text-green-600 font-medium">Based on Lifetime Performance Data</span>
              </div>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <button
              onClick={refetch}
              disabled={queriesLoading}
              className="flex items-center space-x-2 px-3 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className={`h-4 w-4 ${queriesLoading ? 'animate-spin' : ''}`} />
              <span>Refresh</span>
            </button>
            <button
              onClick={handleExport}
              disabled={filteredAndSortedCitations.length === 0}
              className="flex items-center space-x-2 bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <Download className="h-4 w-4" />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Data Source Info Banner */}
        <div className="bg-green-50 border border-green-200 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="w-3 h-3 bg-green-500 rounded-full"></div>
            <div>
              <h3 className="font-semibold text-green-900">Lifetime Performance Data</h3>
              <p className="text-sm text-green-700">
                Citations are sourced from all historical queries processed for your brand, providing comprehensive long-term citation patterns and trends.
              </p>
            </div>
          </div>
        </div>

        {/* Analytics Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Card className="p-4 flex-1">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Quote className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total Citations</p>
                <p className="text-2xl font-bold text-foreground">{analytics.totalCitations}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 flex-1">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Globe className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Domain Citations</p>
                <p className="text-2xl font-bold text-foreground">{analytics.domainCitations}</p>
                <p className="text-xs text-purple-600">{analytics.domainCitationRate.toFixed(1)}% of total</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 flex-1">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <MessageSquare className="h-5 w-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Brand Mentions</p>
                <p className="text-2xl font-bold text-foreground">{analytics.brandMentions}</p>
                <p className="text-xs text-yellow-600">{analytics.brandMentionRate.toFixed(1)}% of total</p>
              </div>
            </div>
          </Card>

          <Card className="p-4 flex-1">
            <div className="flex items-center space-x-3">
              <div className="p-2 bg-orange-100 rounded-lg">
                <BarChart3 className="h-5 w-5 text-orange-600" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Unique Domains</p>
                <p className="text-2xl font-bold text-foreground">{analytics.uniqueDomains}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Platform Statistics and Most Cited Domains */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          <Card className="p-6">
            <h3 className="text-lg font-semibold text-foreground mb-4">Platform Distribution</h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">ChatGPT</span>
                <span className="font-medium">{analytics.providerStats.chatgpt}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Perplexity</span>
                <span className="font-medium">{analytics.providerStats.perplexity}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Google AI</span>
                <span className="font-medium">{analytics.providerStats.googleAI}</span>
              </div>
            </div>
          </Card>

          {/* Most Cited Domains - Full Width */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Most Cited Domains</h3>
              <Link href="/dashboard/citations/all-domains" className="text-sm text-blue-600 hover:text-blue-800 flex items-center">
                View All <ExternalLink className="h-4 w-4 ml-1" />
              </Link>
            </div>
            <div className="space-y-4">
              {analytics.topDomains.map(([domain, count], index) => (
                <div key={domain} className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <WebLogo domain={`https://${domain}`} className="w-6 h-6" size={24} />
                    <div>
                      <div className="flex items-center space-x-2">
                        <span className="font-medium text-foreground">{domain}</span>
                        <a
                          href={`https://${domain}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-gray-400 hover:text-gray-600"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {count} citation{count !== 1 ? 's' : ''}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <div className="w-32 bg-gray-200 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full"
                        style={{
                          width: `${(count / analytics.topDomains[0][1]) * 100}%`
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

      
        {/* All Citations Table */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-semibold text-foreground">All Citations</h3>
            <div className="text-sm text-muted-foreground">
              Total: {totalCitationsFromHook} citations
            </div>
          </div>
          <CitationsTable citations={allCitations.filter(c => c.domain)} />
        </Card>
      </div>
    </DashboardLayout>
  );
} 