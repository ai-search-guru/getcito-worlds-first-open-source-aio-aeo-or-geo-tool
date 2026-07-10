'use client'
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, ArrowRight, Building2, Users, Tag, TrendingUp, ExternalLink, RefreshCw, Globe, Search, Sparkles, Brain, Target, BarChart3, Zap, DollarSign, MessageSquare, Edit3, Plus, X } from 'lucide-react';
import WebLogo from '@/components/shared/WebLogo';
import { CompanyInfo } from '@/lib/get-company-info';
import { useAIQuery } from '@/hooks/useAIQuery';

export default function AddBrandStep2(): React.ReactElement {
  const router = useRouter();
  const [domain, setDomain] = useState<string>('');
  const [companyData, setCompanyData] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Editing states
  const [editingDescription, setEditingDescription] = useState(false);
  const [editingProducts, setEditingProducts] = useState(false);
  const [editingKeywords, setEditingKeywords] = useState(false);
  const [editingCompetitors, setEditingCompetitors] = useState(false);
  
  // Temporary edit values
  const [tempDescription, setTempDescription] = useState('');
  const [tempProducts, setTempProducts] = useState<string[]>([]);
  const [tempKeywords, setTempKeywords] = useState<string[]>([]);
  const [tempCompetitors, setTempCompetitors] = useState<string[]>([]);
  const [newKeyword, setNewKeyword] = useState('');
  const [newCompetitor, setNewCompetitor] = useState('');
  
  const { queryState, executeQuery, clearQuery } = useAIQuery();

  useEffect(() => {
    // Get domain and company info data from sessionStorage
    const storedDomain = sessionStorage.getItem('brandDomain');
    const storedCompanyInfo = sessionStorage.getItem('companyInfo');
    
    if (!storedDomain) {
      // If no domain found, redirect back to step 1
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    setDomain(storedDomain);
    
    if (storedCompanyInfo) {
      try {
        const parsedCompanyInfo = JSON.parse(storedCompanyInfo);
        setCompanyData(parsedCompanyInfo);
      } catch (error) {
        console.error('Failed to parse company info data:', error);
      }
    }
    
    setLoading(false);
  }, [router]);

  const generateInsights = async (type: 'competitive' | 'marketing' | 'insights') => {
    if (!companyData || !domain) return;

    const prompts = {
      competitive: `Analyze the comprehensive competitive landscape for ${companyData.companyName} (${domain}). 
      Company description: ${companyData.shortDescription}
      Products/Services: ${companyData.productsAndServices?.join(', ')}
      Known competitors: ${companyData.competitors?.join(', ') || 'None listed'}
      
      Instructions:
      - Identify companies that offer the SAME or SIMILAR products/services as listed above
      - Include both direct competitors (same target market) and indirect competitors (alternative solutions)
      - Consider companies that solve the same customer problems with different approaches
      - Look for businesses targeting the same customer segments or industries
      
      Provide:
      1. DIRECT COMPETITORS: Companies offering identical/very similar products/services
      2. INDIRECT COMPETITORS: Companies offering alternative solutions to the same customer problems
      3. SERVICE-BASED COMPETITORS: If this company offers services, include other service providers in the same domain
      4. PRODUCT-BASED COMPETITORS: If this company offers products, include companies with competing products
      5. Competitive advantages and weaknesses analysis
      6. Market positioning comparison
      7. Differentiation opportunities
      8. Market share insights (if available)
      
      Format as JSON with sections: directCompetitors, indirectCompetitors, serviceCompetitors, productCompetitors, advantages, weaknesses, positioning, opportunities`,
      
      marketing: `Create comprehensive marketing strategies for ${companyData.companyName} (${domain}).
      Company description: ${companyData.shortDescription}
      Products/Services: ${companyData.productsAndServices?.join(', ')}
      Keywords: ${companyData.keywords?.join(', ')}
      
      Provide:
      1. Target audience segments
      2. Content marketing strategies
      3. Social media recommendations
      4. SEO optimization suggestions
      5. Paid advertising strategies
      6. Budget allocation recommendations
      
      Format as JSON with sections: audience, content, social, seo, advertising, budget`,
      
      insights: `Provide comprehensive business insights for ${companyData.companyName} (${domain}).
      Company description: ${companyData.shortDescription}
      Products/Services: ${companyData.productsAndServices?.join(', ')}
      Keywords: ${companyData.keywords?.join(', ')}
      
      Provide:
      1. Industry trends analysis
      2. Growth opportunities
      3. Revenue potential assessment
      4. Technology stack recommendations
      5. Partnership opportunities
      6. Future market predictions
      
      Format as JSON with sections: trends, opportunities, revenue, technology, partnerships, predictions`
    };

    await executeQuery(
      prompts[type],
      ['azure-openai', 'google-gemini'],
      'high',
      'brand-analysis-user'
    );
  };

  const handleReanalyze = () => {
    // Clear company data and go back to step 1 for re-analysis
    sessionStorage.removeItem('companyInfo');
    clearQuery();
    router.push('/dashboard/add-brand/step-1');
  };

  const handleContinue = () => {
    // Store AI insights for step 3 if available
    if (queryState.result) {
      sessionStorage.setItem('aiInsights', JSON.stringify(queryState.result));
    }
    router.push('/dashboard/add-brand/step-3');
  };

  // Editing functions
  const startEditingDescription = () => {
    setTempDescription(companyData?.shortDescription || '');
    setEditingDescription(true);
  };

  const saveDescription = () => {
    if (companyData) {
      const updatedData = { ...companyData, shortDescription: tempDescription };
      setCompanyData(updatedData);
      sessionStorage.setItem('companyInfo', JSON.stringify(updatedData));
    }
    setEditingDescription(false);
  };

  const cancelEditingDescription = () => {
    setEditingDescription(false);
    setTempDescription('');
  };

  const startEditingProducts = () => {
    setTempProducts([...(companyData?.productsAndServices || [])]);
    setEditingProducts(true);
  };

  const saveProducts = () => {
    if (companyData) {
      const updatedData = { ...companyData, productsAndServices: tempProducts };
      setCompanyData(updatedData);
      sessionStorage.setItem('companyInfo', JSON.stringify(updatedData));
    }
    setEditingProducts(false);
  };

  const cancelEditingProducts = () => {
    setEditingProducts(false);
    setTempProducts([]);
  };

  const addProduct = () => {
    setTempProducts([...tempProducts, '']);
  };

  const updateProduct = (index: number, value: string) => {
    const updated = [...tempProducts];
    updated[index] = value;
    setTempProducts(updated);
  };

  const removeProduct = (index: number) => {
    setTempProducts(tempProducts.filter((_, i) => i !== index));
  };

  const startEditingKeywords = () => {
    setTempKeywords([...(companyData?.keywords || [])]);
    setEditingKeywords(true);
  };

  const saveKeywords = () => {
    if (companyData) {
      const updatedData = { ...companyData, keywords: tempKeywords };
      setCompanyData(updatedData);
      sessionStorage.setItem('companyInfo', JSON.stringify(updatedData));
    }
    setEditingKeywords(false);
  };

  const cancelEditingKeywords = () => {
    setEditingKeywords(false);
    setTempKeywords([]);
    setNewKeyword('');
  };

  const addKeyword = () => {
    if (newKeyword.trim() && !tempKeywords.includes(newKeyword.trim()) && tempKeywords.length < 10) {
      setTempKeywords([...tempKeywords, newKeyword.trim()]);
      setNewKeyword('');
    }
  };

  const removeKeyword = (index: number) => {
    setTempKeywords(tempKeywords.filter((_, i) => i !== index));
  };

  const startEditingCompetitors = () => {
    setTempCompetitors([...(companyData?.competitors || [])]);
    setEditingCompetitors(true);
  };

  const saveCompetitors = () => {
    if (companyData) {
      const updatedData = { ...companyData, competitors: tempCompetitors };
      setCompanyData(updatedData);
      sessionStorage.setItem('companyInfo', JSON.stringify(updatedData));
    }
    setEditingCompetitors(false);
  };

  const cancelEditingCompetitors = () => {
    setEditingCompetitors(false);
    setTempCompetitors([]);
    setNewCompetitor('');
  };

  const addCompetitor = () => {
    if (newCompetitor.trim() && !tempCompetitors.includes(newCompetitor.trim()) && tempCompetitors.length < 10) {
      setTempCompetitors([...tempCompetitors, newCompetitor.trim()]);
      setNewCompetitor('');
    }
  };

  const removeCompetitor = (index: number) => {
    setTempCompetitors(tempCompetitors.filter((_, i) => i !== index));
  };

  const renderAIInsights = () => {
    if (queryState.loading) {
      return (
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="flex items-center justify-center space-x-3">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#000C60]"></div>
            <p className="text-lg text-muted-foreground">Generating AI insights...</p>
          </div>
        </div>
      );
    }

    if (queryState.error) {
      return (
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="text-center">
            <p className="text-red-500 mb-4">Error generating insights: {queryState.error}</p>
            <button
              onClick={() => generateInsights('insights')}
              className="bg-[#000C60] text-white px-4 py-2 rounded-lg hover:bg-[#000C60]/90 transition-colors"
            >
              Retry
            </button>
          </div>
        </div>
      );
    }

    if (!queryState.result) {
      return (
        <div className="bg-card border border-border rounded-xl p-8">
          <div className="text-center">
            <Brain className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-4">AI-Powered Business Insights</h3>
            <p className="text-muted-foreground mb-6">
              Get comprehensive analysis including competitive landscape, marketing strategies, and growth opportunities.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <button
                onClick={() => generateInsights('insights')}
                className="bg-[#000C60] text-white p-4 rounded-lg hover:bg-[#000C60]/90 transition-colors flex flex-col items-center space-y-2"
              >
                <TrendingUp className="h-6 w-6" />
                <span>Business Insights</span>
              </button>
              <button
                onClick={() => generateInsights('competitive')}
                className="bg-[#93E85F] text-black p-4 rounded-lg hover:bg-[#93E85F]/90 transition-colors flex flex-col items-center space-y-2"
              >
                <BarChart3 className="h-6 w-6" />
                <span>Competitive Analysis</span>
              </button>
              <button
                onClick={() => generateInsights('marketing')}
                className="bg-[#00B087] text-white p-4 rounded-lg hover:bg-[#00B087]/90 transition-colors flex flex-col items-center space-y-2"
              >
                <Target className="h-6 w-6" />
                <span>Marketing Strategy</span>
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Display AI results
    const aiData = queryState.result.data;
    const providersUsed = queryState.result.debug?.providersExecuted || [];
    
    try {
      const parsedData = typeof aiData === 'string' ? JSON.parse(aiData) : aiData;
      
      return (
        <div className="space-y-6">
          {/* AI Results Header */}
          <div className="bg-accent/30 border border-border rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <Brain className="h-6 w-6 text-[#000C60]" />
                <h3 className="text-lg font-semibold text-foreground">AI Analysis Results</h3>
              </div>
              <div className="flex items-center space-x-2 text-sm text-muted-foreground">
                <Zap className="h-4 w-4" />
                <span>Powered by {providersUsed.join(', ')}</span>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="text-center">
                <div className="text-lg font-semibold text-foreground">{queryState.result.results.length}</div>
                <div className="text-sm text-muted-foreground">AI Providers</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-foreground">${queryState.result.totalCost.toFixed(4)}</div>
                <div className="text-sm text-muted-foreground">Total Cost</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-foreground">
                  {Math.round((Date.now() - new Date(queryState.result.completedAt).getTime()) / 1000)}s
                </div>
                <div className="text-sm text-muted-foreground">Response Time</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-semibold text-[#00B087]">✓</div>
                <div className="text-sm text-muted-foreground">Analysis Complete</div>
              </div>
            </div>
          </div>

          {/* Display parsed AI insights */}
          {parsedData && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(parsedData).map(([key, value]) => (
                <div key={key} className="bg-card border border-border rounded-xl p-6">
                  <h4 className="text-foreground font-semibold mb-4 capitalize">
                    {key.replace(/([A-Z])/g, ' $1').trim()}
                  </h4>
                  <div className="text-sm text-muted-foreground">
                    {Array.isArray(value) ? (
                      <ul className="space-y-1">
                        {value.map((item, index) => (
                          <li key={index}>• {typeof item === 'object' ? JSON.stringify(item) : String(item)}</li>
                        ))}
                      </ul>
                    ) : typeof value === 'object' ? (
                      <pre className="whitespace-pre-wrap text-xs">{JSON.stringify(value, null, 2)}</pre>
                    ) : (
                      <p>{String(value)}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Raw AI Response (Debug) */}
          <details className="bg-muted/30 border border-border rounded-xl p-4">
            <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
              View Raw AI Response (Debug)
            </summary>
            <pre className="mt-4 text-xs text-muted-foreground whitespace-pre-wrap">
              {JSON.stringify(queryState.result, null, 2)}
            </pre>
          </details>
        </div>
      );
    } catch (error) {
      return (
        <div className="bg-card border border-border rounded-xl p-6">
          <p className="text-yellow-600 mb-4">Raw AI Response (parsing failed):</p>
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
            {JSON.stringify(aiData, null, 2)}
          </pre>
        </div>
      );
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0E353C] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#93E85F]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E353C] flex flex-col">
      {/* Header with Logo */}
      <div className="flex justify-center pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2">
          {/* AI Monitor Logo */}
          <div className="relative w-48 h-12">
            <Image
              src="/getcito-logo-dark.webp"
              alt="AI Monitor Logo"
              width={192}
              height={48}
              className="block dark:hidden w-full h-auto"
              priority
            />
            <Image
              src="/AI-Monitor-Logo-V3-long-dark-themel.png"
              alt="AI Monitor Logo"
              width={192}
              height={48}
              className="hidden dark:block w-full h-auto"
              priority
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex justify-center px-4">
        <div className="w-full max-w-6xl">
          {/* Step Indicators */}
          <div className="flex justify-center mb-12">
            <div className="flex items-center space-x-8">
              {/* Step 1 - Completed */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#93E85F] text-black rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  ✓
                </div>
                <span className="text-gray-300 text-sm">Domain</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-[#93E85F]"></div>

              {/* Step 2 - Active */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#93E85F] text-black rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  2
                </div>
                <span className="text-white text-sm font-medium">Brand</span>
              </div>

              {/* Connector */}
              <div className="w-16 h-px bg-[#1a4a54]"></div>

              {/* Step 3 - Inactive */}
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 bg-[#164a54] text-gray-400 rounded-full flex items-center justify-center text-lg font-semibold mb-2">
                  3
                </div>
                <span className="text-gray-400 text-sm">Queries</span>
              </div>
            </div>
          </div>

          {/* Main Card */}
          <div className="bg-[#0a2a30] border border-[#1a4a54] rounded-2xl p-8 shadow-lg">
            {companyData ? (
              <div className="space-y-8">
                {/* Brand Header with Logo */}
                <div className="bg-[#0E353C] border border-[#1a4a54] rounded-xl p-6">
                  <div className="flex items-center justify-between mb-6">
                    <h1 className="text-3xl font-bold text-white">Brand Analysis</h1>
                    <button
                      onClick={handleReanalyze}
                      className="text-[#93E85F] hover:text-[#93E85F]/80 flex items-center space-x-1 text-sm"
                    >
                      <RefreshCw className="h-4 w-4" />
                      <span>Re-analyze</span>
                    </button>
                  </div>
                  
                  <div className="flex items-start space-x-6">
                    {/* Web Logo */}
                    <div className="flex-shrink-0">
                      <WebLogo domain={domain} size={64} className="shadow-lg" />
                    </div>
                    
                    {/* Company Info */}
                    <div className="flex-1">
                      <div className="flex items-center space-x-3 mb-3">
                        <h2 className="text-2xl font-bold text-white">{companyData.companyName || 'Unknown Company'}</h2>
                        <span className="text-gray-300">({domain})</span>
                      </div>
                      <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                          <h3 className="text-lg font-semibold text-white">Short Description</h3>
                          <button
                            onClick={startEditingDescription}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        {editingDescription ? (
                          <div className="space-y-3">
                            <textarea
                              value={tempDescription}
                              onChange={(e) => setTempDescription(e.target.value)}
                              className="w-full p-3 border border-[#1a4a54] rounded-lg bg-[#0E353C] text-white resize-none"
                              rows={3}
                              placeholder="Enter company description..."
                            />
                            <div className="flex space-x-2">
                              <button
                                onClick={saveDescription}
                                className="px-3 py-1 bg-[#93E85F] text-black text-sm rounded-lg hover:bg-[#93E85F]/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingDescription}
                                className="px-3 py-1 bg-[#164a54] text-gray-300 text-sm rounded-lg hover:bg-[#1a4a54] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-gray-300 text-lg">
                            {companyData.shortDescription || 'No description available'}
                          </p>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap gap-4">
                        <div className="flex items-center space-x-2">
                          <Globe className="h-4 w-4 text-gray-400" />
                          <a
                            href={companyData.website}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-[#93E85F] hover:underline"
                          >
                            {companyData.website}
                          </a>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Sparkles className="h-4 w-4 text-gray-400" />
                          <span className="text-sm text-gray-300">AI-Powered Analysis</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Company Information Content */}
                  <div className="space-y-6">
                    {/* Key Information Grid */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Products & Services */}
                      <div className="bg-[#0E353C] border border-[#1a4a54] rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-[#93E85F] rounded-lg">
                              <Building2 className="h-5 w-5 text-black" />
                            </div>
                            <h4 className="text-white font-semibold">Products & Services</h4>
                          </div>
                          <button
                            onClick={startEditingProducts}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingProducts ? (
                          <div className="space-y-3">
                            {tempProducts.map((product, index) => (
                              <div key={index} className="flex items-center space-x-2">
                                <input
                                  type="text"
                                  value={product}
                                  onChange={(e) => updateProduct(index, e.target.value)}
                                  className="flex-1 p-2 border border-[#1a4a54] rounded-lg bg-[#0E353C] text-white text-sm"
                                  placeholder="Enter product or service..."
                                />
                                <button
                                  onClick={() => removeProduct(index)}
                                  className="p-1 text-red-500 hover:text-red-700 transition-colors"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ))}
                            <button
                              onClick={addProduct}
                              className="flex items-center space-x-1 text-[#93E85F] hover:text-[#93E85F]/80 transition-colors text-sm"
                            >
                              <Plus className="h-4 w-4" />
                              <span>Add product/service</span>
                            </button>
                            <div className="flex space-x-2 pt-2">
                              <button
                                onClick={saveProducts}
                                className="px-3 py-1 bg-[#93E85F] text-black text-sm rounded-lg hover:bg-[#93E85F]/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingProducts}
                                className="px-3 py-1 bg-[#164a54] text-gray-300 text-sm rounded-lg hover:bg-[#1a4a54] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {(companyData.productsAndServices && companyData.productsAndServices.length > 0) ? (
                              <>
                                {companyData.productsAndServices.slice(0, 6).map((item: string, index: number) => (
                                  <div key={index} className="text-sm text-gray-300">
                                    • {item}
                                  </div>
                                ))}
                                {companyData.productsAndServices.length > 6 && (
                                  <div className="text-sm text-gray-300 font-medium">
                                    + {companyData.productsAndServices.length - 6} more offerings
                                  </div>
                                )}
                              </>
                            ) : (
                              <div className="text-sm text-gray-300">
                                No products or services listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Keywords */}
                      <div className="bg-[#0E353C] border border-[#1a4a54] rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-[#93E85F] rounded-lg">
                              <Tag className="h-5 w-5 text-black" />
                            </div>
                            <h4 className="text-white font-semibold">Topics & Semantic Clusters</h4>
                          </div>
                          <button
                            onClick={startEditingKeywords}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingKeywords ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 mb-3">
                              {tempKeywords.map((keyword, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#0a2a30] border border-[#1a4a54] text-white text-sm rounded-md"
                                >
                                  {keyword}
                                  <button
                                    onClick={() => removeKeyword(index)}
                                    className="text-red-500 hover:text-red-700 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={newKeyword}
                                onChange={(e) => setNewKeyword(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && addKeyword()}
                                disabled={tempKeywords.length >= 10}
                                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder={tempKeywords.length >= 10 ? "Maximum 10 keywords reached" : "Add keyword..."}
                              />
                              <button
                                onClick={addKeyword}
                                disabled={tempKeywords.length >= 10 || !newKeyword.trim()}
                                className="p-2 bg-[#93E85F] text-black rounded-lg hover:bg-[#93E85F]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="text-xs text-gray-300">
                              {tempKeywords.length}/10 keywords added
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={saveKeywords}
                                className="px-3 py-1 bg-[#93E85F] text-black text-sm rounded-lg hover:bg-[#93E85F]/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingKeywords}
                                className="px-3 py-1 bg-[#164a54] text-gray-300 text-sm rounded-lg hover:bg-[#1a4a54] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(companyData.keywords && companyData.keywords.length > 0) ? (
                              companyData.keywords.map((keyword: string, index: number) => (
                                <span
                                  key={index}
                                  className="px-3 py-1 bg-[#0a2a30] border border-[#1a4a54] text-white text-sm rounded-md"
                                >
                                  {keyword}
                                </span>
                              ))
                            ) : (
                              <div className="text-sm text-gray-300">
                                No keywords listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Competitors */}
                      <div className="bg-[#0E353C] border border-[#1a4a54] rounded-xl p-6">
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center space-x-3">
                            <div className="p-2 bg-[#93E85F] rounded-lg">
                              <Target className="h-5 w-5 text-black" />
                            </div>
                            <h4 className="text-white font-semibold">Competitors</h4>
                          </div>
                          <button
                            onClick={startEditingCompetitors}
                            className="p-1 text-gray-400 hover:text-white transition-colors"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                        
                        {editingCompetitors ? (
                          <div className="space-y-3">
                            <div className="flex flex-wrap gap-2 mb-3">
                              {tempCompetitors.map((competitor, index) => (
                                <span
                                  key={index}
                                  className="inline-flex items-center gap-1 px-3 py-1 bg-[#0a2a30] border border-[#1a4a54] text-white text-sm rounded-md"
                                >
                                  {competitor}
                                  <button
                                    onClick={() => removeCompetitor(index)}
                                    className="text-red-500 hover:text-red-700 transition-colors"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              ))}
                            </div>
                            <div className="flex items-center space-x-2">
                              <input
                                type="text"
                                value={newCompetitor}
                                onChange={(e) => setNewCompetitor(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && addCompetitor()}
                                disabled={tempCompetitors.length >= 10}
                                className="flex-1 p-2 border border-border rounded-lg bg-background text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                                placeholder={tempCompetitors.length >= 10 ? "Maximum 10 competitors reached" : "Add competitor..."}
                              />
                              <button
                                onClick={addCompetitor}
                                disabled={tempCompetitors.length >= 10 || !newCompetitor.trim()}
                                className="p-2 bg-[#93E85F] text-black rounded-lg hover:bg-[#93E85F]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                              >
                                <Plus className="h-4 w-4" />
                              </button>
                            </div>
                            <div className="text-xs text-gray-300">
                              {tempCompetitors.length}/10 competitors added
                            </div>
                            <div className="flex space-x-2">
                              <button
                                onClick={saveCompetitors}
                                className="px-3 py-1 bg-[#93E85F] text-black text-sm rounded-lg hover:bg-[#93E85F]/90 transition-colors"
                              >
                                Save
                              </button>
                              <button
                                onClick={cancelEditingCompetitors}
                                className="px-3 py-1 bg-[#164a54] text-gray-300 text-sm rounded-lg hover:bg-[#1a4a54] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {(companyData.competitors && companyData.competitors.length > 0) ? (
                              companyData.competitors.map((competitor: string, index: number) => (
                                <span
                                  key={index}
                                  className="px-3 py-1 bg-[#0a2a30] border border-[#1a4a54] text-white text-sm rounded-md"
                                >
                                  {competitor}
                                </span>
                              ))
                            ) : (
                              <div className="text-sm text-gray-300">
                                No competitors listed
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                    </div>


                  </div>

                {/* Navigation Buttons */}
                <div className="flex justify-between pt-6">
                  <button
                    onClick={() => router.push('/dashboard/add-brand/step-1')}
                    className="flex items-center space-x-2 bg-[#164a54] text-white px-6 py-3 rounded-xl hover:bg-[#1a4a54] transition-colors"
                  >
                    <ArrowLeft className="h-5 w-5" />
                    <span>Back to Domain</span>
                  </button>

                  <button
                    onClick={handleContinue}
                    className="flex items-center space-x-2 bg-[#93E85F] text-black px-6 py-3 rounded-xl hover:bg-[#93E85F]/90 transition-colors"
                  >
                    <span>Continue to Queries</span>
                    <ArrowRight className="h-5 w-5" />
                  </button>
                </div>
              </div>
            ) : (
              /* Fallback if no company data */
              <div className="text-center">
                <div className="mb-6">
                  <Globe className="h-16 w-16 text-gray-400 mx-auto mb-4" />
                  <h1 className="text-3xl font-bold text-white mb-4">
                    No Company Information Found
                  </h1>
                  <p className="text-gray-300 text-lg mb-8">
                    Please go back to Step 1 to get company information first.
                  </p>
                </div>

                <button
                  onClick={() => router.push('/dashboard/add-brand/step-1')}
                  className="flex items-center space-x-2 bg-[#93E85F] text-black px-6 py-3 rounded-xl hover:bg-[#93E85F]/90 transition-colors mx-auto"
                >
                  <ArrowLeft className="h-5 w-5" />
                  <span>Back to Step 1</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
} 