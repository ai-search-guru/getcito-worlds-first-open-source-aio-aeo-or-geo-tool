'use client'
import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { ArrowLeft, Check, Search, Sparkles, RefreshCw, Eye, Tag, TrendingUp, ShoppingCart, Lightbulb, Target, X, Plus, AlertCircle } from 'lucide-react';
import WebLogo from '@/components/shared/WebLogo';
import { CompanyInfo } from '@/lib/get-company-info';
import { useAIQuery } from '@/hooks/useAIQuery';
import { useUserCredits } from '@/hooks/useUserCredits';
import addData from '@/firebase/firestore/addData';
import { useAuthContext } from '@/context/AuthContext';
import { generateRealisticAnalytics } from '@/utils/generateBrandData';
import { useBrandContext } from '@/context/BrandContext';
import { useToast } from '@/context/ToastContext';

interface GeneratedQuery {
  keyword: string;
  query: string;
  category: 'Awareness' | 'Interest' | 'Consideration' | 'Purchase';
  containsBrand: 0 | 1;
}

export default function AddBrandStep3(): React.ReactElement {
  const router = useRouter();
  const { user } = useAuthContext();
  const { refetchBrands, setSelectedBrandId, clearBrandContext } = useBrandContext();
  const { deduct: deductCredits, credits } = useUserCredits();
  const { showSuccess, showError, showInfo } = useToast();
  const [domain, setDomain] = useState<string>('');
  const [companyData, setCompanyData] = useState<CompanyInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [generatedQueries, setGeneratedQueries] = useState<GeneratedQuery[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string>('all');
  const [showAddTopicModal, setShowAddTopicModal] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [additionalTopics, setAdditionalTopics] = useState<string[]>([]);
  const [showAddQueryModal, setShowAddQueryModal] = useState(false);
  const [newQuery, setNewQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<'Awareness' | 'Interest' | 'Consideration' | 'Purchase'>('Awareness');
  const [isCompleting, setIsCompleting] = useState(false);
  const [selectedQueries, setSelectedQueries] = useState<Set<number>>(new Set());
  
  const { queryState, executeQuery, clearQuery } = useAIQuery();

  useEffect(() => {
    // Get domain and company info from sessionStorage
    const storedDomain = sessionStorage.getItem('brandDomain');
    const storedCompanyInfo = sessionStorage.getItem('companyInfo');
    
    if (!storedDomain || !storedCompanyInfo) {
      // Redirect to step 1 if missing data
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    setDomain(storedDomain);
    
    try {
      const parsedCompanyInfo = JSON.parse(storedCompanyInfo);
      setCompanyData(parsedCompanyInfo);
    } catch (error) {
      console.error('Failed to parse company info:', error);
      router.push('/dashboard/add-brand/step-1');
      return;
    }
    
    setLoading(false);
  }, [router]);

  // Auto-generate queries when company data is loaded
  useEffect(() => {
    if (companyData && companyData.keywords && companyData.keywords.length > 0 && generatedQueries.length === 0) {
      // Small delay to ensure UI is ready
      setTimeout(() => {
        generateQueries();
      }, 500);
    }
  }, [companyData, generatedQueries.length]);

  const generateQueries = async () => {
    if (!companyData) return;
    
    setIsGenerating(true);
    
    const prompt = `You are an AI assistant that generates realistic and user-centric search queries based on brand information.

Given:
- Brand: ${companyData.companyName}
- Description: ${companyData.shortDescription}
- Products & Services: ${companyData.productsAndServices?.join(', ')}
- Keywords: ${companyData.keywords?.join(', ')}

Task:
1. For each keyword, generate 2–3 realistic, natural-sounding user search queries that span various funnel stages: **Awareness**, **Interest**, **Consideration**, and **Purchase**.
2. Assign the appropriate funnel stage to each query using the \`category\` field.
3. If the brand is well-known (e.g., Coca-Cola, Nike) or moderately known (e.g., Shoeshack, HubSpot), include the brand name in **only 1–2 queries total**. All other queries should remain brand-agnostic while still being contextually relevant.
4. Use the \`containsBrand\` field to indicate whether the query explicitly includes the brand name:
   - \`1\` = brand name is present
   - \`0\` = brand name is not present
5. Ensure all queries are natural, human-like, relevant to the brand's actual category, and free from inappropriate or misleading content.

Output format (return ONLY valid JSON array):
[
  {
    "keyword": "crm tools",
    "query": "best crm tools for startups",
    "category": "Interest",
    "containsBrand": 0
  },
  {
    "keyword": "crm tools", 
    "query": "is HubSpot good for small business CRM?",
    "category": "Consideration",
    "containsBrand": 1
  }
]`;

    try {
      await executeQuery(
        prompt,
        ['azure-openai'], // Only use OpenAI for now, Gemini available for future use
        'high',
        'query-generation'
      );
    } catch (error) {
      console.error('Failed to generate queries:', error);
      setIsGenerating(false);
    }
  };

  // Watch for query results
  useEffect(() => {
    console.log('🔍 Query State Changed:', queryState);
    
    if (queryState.result && !queryState.loading) {
      try {
        console.log('📊 Raw AI Response:', queryState.result);
        const aiResponse = queryState.result.data;
        console.log('📋 AI Response Data:', aiResponse);
        
        let parsedQueries: GeneratedQuery[] = [];
        
        if (typeof aiResponse === 'string') {
          console.log('🔤 Parsing string response...');
          // Try to extract JSON from the string if it's wrapped in text
          const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            parsedQueries = JSON.parse(jsonMatch[0]);
          } else {
            parsedQueries = JSON.parse(aiResponse);
          }
        } else if (Array.isArray(aiResponse)) {
          console.log('📋 Using array response...');
          parsedQueries = aiResponse;
        } else if (aiResponse && typeof aiResponse === 'object') {
          console.log('🔄 Object response, checking structure...');
          
          // Check if response has a content field (OpenAI format)
          if (aiResponse.content && typeof aiResponse.content === 'string') {
            console.log('📄 Found content field, parsing...');
            const jsonMatch = aiResponse.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedQueries = JSON.parse(jsonMatch[0]);
            } else {
              parsedQueries = JSON.parse(aiResponse.content);
            }
          }
          // Check if response has responses array (API provider format)
          else if (aiResponse.responses && Array.isArray(aiResponse.responses)) {
            console.log('📄 Found responses array, extracting content...');
            const firstResponse = aiResponse.responses[0];
            if (firstResponse && firstResponse.content) {
              console.log('📄 Raw content:', firstResponse.content);
              // Clean the content by removing extra whitespace and line breaks
              let cleanContent = firstResponse.content.trim();
              
              // Try to extract JSON array from the content
              const jsonMatch = cleanContent.match(/\[[\s\S]*\]/);
              if (jsonMatch) {
                console.log('📄 Extracted JSON:', jsonMatch[0]);
                parsedQueries = JSON.parse(jsonMatch[0]);
              } else {
                // If no match, try parsing the entire content
                console.log('📄 Parsing entire content...');
                parsedQueries = JSON.parse(cleanContent);
              }
            }
          }
          // Check if it's a direct object with provider and content
          else if (aiResponse.provider && aiResponse.content) {
            console.log('📄 Found provider response format...');
            const jsonMatch = aiResponse.content.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
              parsedQueries = JSON.parse(jsonMatch[0]);
            } else {
              parsedQueries = JSON.parse(aiResponse.content);
            }
          }
          else {
            console.log('🔄 Unexpected object format:', aiResponse);
          }
        } else {
          console.log('🔄 Unexpected response format:', typeof aiResponse);
        }
        
        console.log('✅ Found queries:', parsedQueries);
        setGeneratedQueries(parsedQueries);
        
        // Auto-select all newly generated queries
        setSelectedQueries(new Set(parsedQueries.map((_, index) => index)));
        
        // Show success notification for auto-generated queries
        if (parsedQueries.length > 0) {
          showSuccess(
            'Query Search Completed!',
            `Found ${parsedQueries.length} relevant queries for ${companyData?.companyName}. You can add more or edit existing ones.`
          );
        }
              } catch (error) {
          console.error('❌ Failed to parse found queries:', error);
        console.error('Raw response:', queryState.result.data);
        console.error('Error details:', error);
        
        // Try alternative parsing for debugging
        if (queryState.result.data?.responses?.[0]?.content) {
          const content = queryState.result.data.responses[0].content;
          console.log('🔧 Full content for debugging:', content);
          
          // Try to manually extract and parse
          try {
            const startIndex = content.indexOf('[');
            const endIndex = content.lastIndexOf(']');
            if (startIndex !== -1 && endIndex !== -1) {
              const jsonStr = content.substring(startIndex, endIndex + 1);
              console.log('🔧 Extracted JSON string:', jsonStr);
              const manualParsed = JSON.parse(jsonStr);
              console.log('🔧 Manual parsing successful:', manualParsed);
              setGeneratedQueries(manualParsed);
            }
          } catch (manualError) {
            console.error('🔧 Manual parsing also failed:', manualError);
          }
        }
      }
      setIsGenerating(false);
    }
    
    if (queryState.error) {
      console.error('❌ Query error:', queryState.error);
      setIsGenerating(false);
    }
  }, [queryState]);

  const handleComplete = async () => {
    if (!companyData || selectedQueries.size < 4 || !user?.uid) {
      console.error('Missing required data for completion:', {
        hasCompanyData: !!companyData,
        hasMinimumQueries: selectedQueries.size >= 4,
        selectedCount: selectedQueries.size,
        minimumRequired: 4,
        hasUser: !!user?.uid
      });
      return;
    }

    // Check if user has enough credits
    if (credits < 100) {
      showError(
        'Insufficient Credits',
        `You need 100 credits to complete brand setup, but you only have ${credits} credits available. Please purchase more credits to continue.`
      );
      return;
    }

    setIsCompleting(true);

    try {
      // Deduct 100 credits for brand setup completion
      console.log('💰 Deducting 100 credits for brand setup completion...');
      const { success: creditSuccess, error: creditError } = await deductCredits(100);
      
      if (!creditSuccess) {
        console.error('❌ Failed to deduct credits:', creditError);
        showError(
          'Credit Processing Failed',
          'Unable to process credit deduction. Please try again or contact support if the issue persists.'
        );
        setIsCompleting(false);
        return;
      }
      
      console.log('✅ Successfully deducted 100 credits');

      console.log('🚀 Generating brand analytics...');
      
      // Generate brand analytics data client-side
      const brandsbasicData = generateRealisticAnalytics(
        companyData.companyName,
        domain,
        companyData.keywords || []
      );
      
      console.log('✅ Brand analytics generated:', brandsbasicData);

      // Prepare complete brand data for Firestore
      const completeBrandData = {
        // User Information
        userId: user.uid,
        
        // Step 1 - Domain Information
        domain: domain,
        website: companyData.website,
        
        // Step 2 - Company Information
        companyName: companyData.companyName,
        shortDescription: companyData.shortDescription,
        productsAndServices: companyData.productsAndServices || [],
        keywords: companyData.keywords || [],
        competitors: companyData.competitors || [],
        
        // Step 3 - Generated Queries (only selected ones)
        queries: generatedQueries
          .filter((_, index) => selectedQueries.has(index))
          .map(query => ({
            keyword: query.keyword,
            query: query.query,
            category: query.category,
            containsBrand: query.containsBrand,
            selected: true
          })),
        
        // Query distribution by category (only selected queries)
        queryDistribution: {
          awareness: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Awareness').length,
          interest: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Interest').length,
          consideration: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Consideration').length,
          purchase: generatedQueries.filter((q, i) => selectedQueries.has(i) && q.category === 'Purchase').length
        },
        
        // AI Analysis metadata (if available)
        aiAnalysis: queryState.result ? {
          providersUsed: queryState.result.debug?.providersExecuted || [],
          totalCost: queryState.result.totalCost || 0,
          completedAt: queryState.result.completedAt || new Date().toISOString(),
          requestId: queryState.result.requestId || null
        } : null,
        
        // Generated brand analytics
        brandsbasicData,
        
        // Metadata
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timestamp: Date.now(),
        totalQueries: selectedQueries.size,
        setupComplete: true,
        currentStep: 3,
        
        // Credit usage tracking
        creditsUsed: 100,
        creditTransaction: {
          amount: 100,
          type: 'deduction',
          reason: 'Brand setup completion',
          timestamp: new Date().toISOString()
        }
      };

      // Generate user-scoped document ID to prevent conflicts
      const cleanDomain = domain.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
      const brandId = `${user.uid}_${cleanDomain}`;
      
      console.log('💾 Saving complete brand data to Firestore...');
      const { result: saveResult, error: saveError } = await addData('v8userbrands', brandId, completeBrandData);
      
      if (saveError) {
        console.error('❌ Error saving brand data:', saveError);
        
        // Refund credits if save failed
        console.log('🔄 Refunding credits due to save error...');
        await deductCredits(-100); // Add credits back
        
        showError(
          'Save Failed',
          'Unable to save your brand data. Your credits have been refunded. Please try again.'
        );
        setIsCompleting(false);
        return;
      }
      
      console.log('✅ Brand data saved successfully to Firestore:', brandId);
      
      // Clear all local storage and session storage
      console.log('🧹 Clearing local storage and session storage...');
      localStorage.clear();
      sessionStorage.clear();
      
      // Refresh brands in context and set the new brand as selected
      console.log('🔄 Refreshing brand context...');
      await refetchBrands(); // Refresh the brands list
      
      // Set the newly created brand as the selected brand
      console.log('✅ Setting new brand as selected:', brandId);
      setSelectedBrandId(brandId);
      
      console.log('✅ Brand setup completed successfully! (100 credits deducted)');
      
      // Show comprehensive completion notification
      showSuccess(
        '🎉 Brand Setup Complete!',
        `${companyData.companyName} has been added with ${selectedQueries.size} selected queries. Your first processing is ready to begin!`
      );
      
      // Show info about next steps
      setTimeout(() => {
        showInfo(
          'Ready to Process Queries',
          'You can now process your queries to see how AI platforms respond to questions about your brand. Each query costs 10 credits.'
        );
      }, 2000);
      
      console.log('🎯 Redirecting directly to queries page...');
      
      // Navigate directly to queries page
      router.replace('/dashboard/queries');
      
    } catch (error) {
      console.error('❌ Error during setup completion:', error);
      
      // Try to refund credits if an error occurred
      try {
        console.log('🔄 Attempting to refund credits due to error...');
        await deductCredits(-100);
      } catch (refundError) {
        console.error('❌ Failed to refund credits:', refundError);
      }
      
      showError(
        'Setup Failed',
        'An unexpected error occurred during brand setup. Please try again or contact support if the issue persists.'
      );
      setIsCompleting(false);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'Awareness': return <Eye className="h-4 w-4" />;
      case 'Interest': return <Lightbulb className="h-4 w-4" />;
      case 'Consideration': return <TrendingUp className="h-4 w-4" />;
      case 'Purchase': return <ShoppingCart className="h-4 w-4" />;
      default: return <Search className="h-4 w-4" />;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Awareness': return 'bg-blue-100 text-blue-700 border-blue-200';
      case 'Interest': return 'bg-yellow-100 text-yellow-700 border-yellow-200';
      case 'Consideration': return 'bg-purple-100 text-purple-700 border-purple-200';
      case 'Purchase': return 'bg-green-100 text-green-700 border-green-200';
      default: return 'bg-gray-100 text-gray-700 border-gray-200';
    }
  };

  // Group queries by keyword
  const queriesByKeyword = generatedQueries.reduce((acc, query) => {
    if (!acc[query.keyword]) {
      acc[query.keyword] = [];
    }
    acc[query.keyword].push(query);
    return acc;
  }, {} as Record<string, GeneratedQuery[]>);

  // Filter queries based on selected topic
  const filteredQueries = selectedTopic === 'all' 
    ? generatedQueries 
    : generatedQueries.filter(q => q.keyword === selectedTopic);

  const filteredQueriesByKeyword = selectedTopic === 'all' 
    ? queriesByKeyword 
    : { [selectedTopic]: queriesByKeyword[selectedTopic] || [] };

  // Get all topics (original keywords + additional topics)
  const allTopics = [...(companyData?.keywords || []), ...additionalTopics];
  const totalTopics = allTopics.length;
  const canAddMoreTopics = totalTopics < 10;

  const handleAddTopic = () => {
    if (canAddMoreTopics) {
      setShowAddTopicModal(true);
    }
  };

  const handleSaveTopic = () => {
    if (newTopicName.trim() && canAddMoreTopics) {
      const trimmedTopic = newTopicName.trim().toLowerCase();
      
      // Check if topic already exists
      if (!allTopics.some(topic => topic.toLowerCase() === trimmedTopic)) {
        setAdditionalTopics(prev => [...prev, trimmedTopic]);
        setNewTopicName('');
        setShowAddTopicModal(false);
        
        // Update sessionStorage with new topics
        if (companyData) {
          const updatedCompanyData = {
            ...companyData,
            keywords: [...(companyData.keywords || []), trimmedTopic]
          };
          sessionStorage.setItem('companyInfo', JSON.stringify(updatedCompanyData));
        }
      }
    }
  };

  const handleCancelTopic = () => {
    setNewTopicName('');
    setShowAddTopicModal(false);
  };

  // Handle keyboard events for topic modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newTopicName.trim() && canAddMoreTopics) {
      handleSaveTopic();
    } else if (e.key === 'Escape') {
      handleCancelTopic();
    }
  };

  // Query modal handlers
  const handleAddQuery = () => {
    setShowAddQueryModal(true);
  };

  const handleSaveQuery = () => {
    if (newQuery.trim()) {
      const newQueryObject: GeneratedQuery = {
        keyword: selectedTopic === 'all' ? allTopics[0] || 'general' : selectedTopic,
        query: newQuery.trim(),
        category: selectedCategory,
        containsBrand: newQuery.toLowerCase().includes(companyData?.companyName?.toLowerCase() || '') ? 1 : 0
      };
      
      const newIndex = generatedQueries.length;
      setGeneratedQueries(prev => [...prev, newQueryObject]);
      
      // Auto-select the newly added query
      setSelectedQueries(prev => new Set([...prev, newIndex]));
      
      // Show success notification
      showSuccess(
        'Query Added Successfully!',
        `Added "${newQuery.trim()}" to your ${selectedCategory.toLowerCase()} queries.`
      );
      
      setNewQuery('');
      setSelectedCategory('Awareness');
      setShowAddQueryModal(false);
    }
  };

  const handleCancelQuery = () => {
    setNewQuery('');
    setSelectedCategory('Awareness');
    setShowAddQueryModal(false);
  };

  // Handle keyboard events for query modal
  const handleQueryKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && newQuery.trim()) {
      handleSaveQuery();
    } else if (e.key === 'Escape') {
      handleCancelQuery();
    }
  };

  // Checkbox selection handlers
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedQueries(new Set(filteredQueries.map((_, index) => 
        generatedQueries.findIndex(q => q === filteredQueries[index])
      )));
    } else {
      // Deselect only the filtered queries
      const filteredIndices = new Set(filteredQueries.map((_, index) => 
        generatedQueries.findIndex(q => q === filteredQueries[index])
      ));
      setSelectedQueries(prev => new Set([...prev].filter(index => !filteredIndices.has(index))));
    }
  };

  const handleSelectQuery = (queryIndex: number, checked: boolean) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[queryIndex]);
    setSelectedQueries(prev => {
      const newSet = new Set(prev);
      if (checked) {
        newSet.add(actualIndex);
      } else {
        newSet.delete(actualIndex);
      }
      return newSet;
    });
  };

  const areAllFilteredSelected = filteredQueries.length > 0 && filteredQueries.every((_, index) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[index]);
    return selectedQueries.has(actualIndex);
  });

  const selectedFilteredCount = filteredQueries.filter((_, index) => {
    const actualIndex = generatedQueries.findIndex(q => q === filteredQueries[index]);
    return selectedQueries.has(actualIndex);
  }).length;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0E353C] flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#93E85F]"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0E353C] flex flex-col">
      {/* Header with Logo and Step Indicators */}
      <div className="flex flex-col items-center pt-8 pb-6">
        <div className="flex flex-col items-center space-y-2 mb-8">
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

        {/* Step Indicators */}
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

          {/* Step 2 - Completed */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-[#93E85F] text-black rounded-full flex items-center justify-center text-lg font-semibold mb-2">
              ✓
            </div>
            <span className="text-gray-300 text-sm">Brand</span>
          </div>

          {/* Connector */}
          <div className="w-16 h-px bg-[#93E85F]"></div>

          {/* Step 3 - Active */}
          <div className="flex flex-col items-center">
            <div className="w-12 h-12 bg-[#93E85F] text-black rounded-full flex items-center justify-center text-lg font-semibold mb-2">
              3
            </div>
            <span className="text-white text-sm font-medium">Queries</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex px-4 max-w-7xl mx-auto">
        {/* Sidebar - Topics */}
        <div className="w-80 flex-shrink-0 mr-8">
          <div className="bg-[#0a2a30] border border-[#1a4a54] rounded-2xl p-6 shadow-sm sticky top-8">
            {/* Brand Display */}
            {companyData && (
              <div className="mb-6 pb-4 border-b border-border">
                <div className="flex items-center space-x-3 p-3">
                  <WebLogo domain={domain} size={24} />
                  <span className="text-white font-medium truncate">
                    {companyData.companyName}
                  </span>
                </div>
              </div>
            )}

            <h2 className="text-lg font-semibold text-white mb-4">Topics</h2>
            
            {/* Add Topic Button */}
            <button 
              onClick={handleAddTopic}
              disabled={!canAddMoreTopics}
              className={`w-full flex items-center justify-center space-x-2 rounded-lg px-4 py-2 mb-6 transition-colors ${
                canAddMoreTopics
                  ? 'text-[#93E85F] border border-[#93E85F] hover:bg-[#93E85F]/5'
                  : 'text-gray-400 border border-gray-600 cursor-not-allowed'
              }`}
            >
              <Plus className="h-4 w-4" />
              <span>Add a topic</span>
            </button>

            {/* Topics List */}
            <div className="space-y-2">
              {/* All Topics */}
              <div 
                onClick={() => setSelectedTopic('all')}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                  selectedTopic === 'all'
                    ? 'bg-[#93E85F] text-black'
                    : 'bg-[#0E353C] border border-[#1a4a54] text-gray-300 hover:bg-[#164a54]'
                }`}
              >
                <span className="font-medium">All Topics</span>
                <span className="text-sm font-medium">
                  {generatedQueries.length}
                </span>
              </div>

              {/* Individual Topics/Keywords */}
              {allTopics.map((topic, index) => {
                const topicQueries = generatedQueries.filter(q => q.keyword === topic);
                return (
                  <div 
                    key={index} 
                    onClick={() => setSelectedTopic(topic)}
                    className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition-colors ${
                      selectedTopic === topic
                        ? 'bg-[#93E85F] text-black'
                        : 'text-gray-300 hover:bg-[#164a54]'
                    }`}
                  >
                    <span className="capitalize">{topic}</span>
                    <span className="text-sm font-medium">
                      {topicQueries.length}
                    </span>
                  </div>
                );
              })}
              
              {/* Topic Count */}
              <div className="mt-4 pt-4 border-t border-[#1a4a54]">
                <div className="text-xs text-gray-300">
                  {totalTopics}/10 topics added
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1">
          {/* Main Card */}
          <div className="bg-[#0a2a30] border border-[#1a4a54] rounded-2xl p-8 shadow-lg">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-3xl font-bold text-white mb-2">
                  {selectedTopic === 'all' ? 'All Topics' : selectedTopic.charAt(0).toUpperCase() + selectedTopic.slice(1)}
                </h1>
                <div className="flex items-center space-x-4 text-sm text-muted-foreground">
                  <span>📅 Last Queried {new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: '2-digit' })}</span>
                </div>
              </div>
              <div className="flex items-center space-x-4">
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-300">
                    {filteredQueries.length}/{generatedQueries.length} queries shown
                  </span>
                </div>
                {generatedQueries.length > 0 && (
                  <button
                    onClick={handleAddQuery}
                    className="inline-flex items-center space-x-2 bg-[#93E85F] text-black px-4 py-2 rounded-lg hover:bg-[#93E85F]/90 transition-colors"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add a prompt</span>
                  </button>
                )}
              </div>
            </div>

            {/* Generate Queries Button */}
            {generatedQueries.length === 0 && (
              <div className="text-center mb-8">
                <button
                  onClick={generateQueries}
                  disabled={isGenerating || !companyData}
                  className="inline-flex items-center space-x-2 bg-[#93E85F] text-black px-8 py-4 rounded-xl hover:bg-[#93E85F]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isGenerating ? (
                    <>
                      <RefreshCw className="h-5 w-5 animate-spin" />
                      <span>Finding Queries...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-5 w-5" />
                      <span>Find Search Queries</span>
                    </>
                  )}
                </button>
                <p className="text-sm text-muted-foreground mt-2">
                  Finding Queries your Customers are asking AI
                </p>
              </div>
            )}

                         {/* Intent Distribution */}
             {generatedQueries.length > 0 && (
               <div className="space-y-8">
                <div>
                  <h2 className="text-xl font-semibold text-white mb-4">Query Intent Distribution</h2>
                  <p className="text-white text-sm mb-6">
                    Shows the percentage breakdown of different intents based on the queries sent to the AI.
                  </p>
                  
                  {/* Intent Distribution Bar */}
                  <div className="relative h-8 bg-muted rounded-lg overflow-hidden mb-4">
                    {['Awareness', 'Interest', 'Consideration', 'Purchase'].map((category, index) => {
                      const count = filteredQueries.filter(q => q.category === category).length;
                      const percentage = filteredQueries.length > 0 ? (count / filteredQueries.length) * 100 : 0;
                      const colors = ['bg-green-500', 'bg-blue-500', 'bg-yellow-500', 'bg-purple-500'];
                      const previousPercentages = ['Awareness', 'Interest', 'Consideration', 'Purchase']
                        .slice(0, index)
                        .reduce((sum, cat) => {
                          const catCount = filteredQueries.filter(q => q.category === cat).length;
                          return sum + (filteredQueries.length > 0 ? (catCount / filteredQueries.length) * 100 : 0);
                        }, 0);
                      
                      return percentage > 0 ? (
                        <div
                          key={category}
                          className={`absolute top-0 h-full ${colors[index]}`}
                          style={{
                            left: `${previousPercentages}%`,
                            width: `${percentage}%`
                          }}
                        />
                      ) : null;
                    })}
                  </div>
                  
                  {/* Intent Legend */}
                  <div className="flex flex-wrap gap-6 text-sm text-white">
                    {['Awareness', 'Interest', 'Consideration', 'Purchase'].map((category, index) => {
                      const count = filteredQueries.filter(q => q.category === category).length;
                      const percentage = filteredQueries.length > 0 ? Math.round((count / filteredQueries.length) * 100) : 0;
                      const colors = ['bg-green-500', 'bg-blue-500', 'bg-yellow-500', 'bg-purple-500'];
                      
                      return (
                        <div key={category} className="flex items-center space-x-2">
                          <div className={`w-3 h-3 rounded-full ${colors[index]}`}></div>
                          <span>
                            {category} - <span className="font-medium">{percentage}%</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                                                 {/* Prompts Table */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-white">
                      Prompts <span className="text-white">({filteredQueries.length})</span>
                    </h3>
                    <div className="flex items-center space-x-2">
                      <button className="flex items-center space-x-2 text-white hover:text-primary transition-colors">
                        <span>🎯 Intents</span>
                        <span className="text-xs">▼</span>
                      </button>
                      <button className="flex items-center space-x-2 text-white hover:text-primary transition-colors">
                        <span># Topics</span>
                        <span className="text-xs">▼</span>
                      </button>
                    </div>
                  </div>
                  
                  {/* Table */}
                  <div className="bg-[#1a2a2e] border border-gray-700 rounded-lg overflow-hidden shadow-sm">
                    {/* Table Header */}
                    <div className="grid grid-cols-10 gap-4 p-4 bg-[#0f1c1f] border-b border-gray-700 text-sm font-semibold text-white">
                      <div className="col-span-1">
                        <input 
                          type="checkbox" 
                          className="rounded border-gray-600 bg-gray-700 focus:ring-primary focus:ring-2" 
                          checked={areAllFilteredSelected}
                          onChange={(e) => handleSelectAll(e.target.checked)}
                          title={areAllFilteredSelected ? "Deselect all" : "Select all"}
                        />
                      </div>
                      <div className="col-span-6">Prompts <span className="text-white">({selectedFilteredCount}/{filteredQueries.length} selected)</span></div>
                      <div className="col-span-2">Topic</div>
                      <div className="col-span-1">Intent</div>
                    </div>
                    
                    {/* Table Body */}
                    <div className="divide-y divide-gray-700">
                      {filteredQueries.map((query, index) => {
                        const actualIndex = generatedQueries.findIndex(q => q === query);
                        const isSelected = selectedQueries.has(actualIndex);
                        
                        return (
                        <div key={index} className="grid grid-cols-10 gap-4 p-4 hover:bg-[#0f1c1f] transition-colors">
                          <div className="col-span-1">
                            <input 
                              type="checkbox" 
                              className="rounded border-gray-600 bg-gray-700 focus:ring-primary focus:ring-2" 
                              checked={isSelected}
                              onChange={(e) => handleSelectQuery(index, e.target.checked)}
                            />
                          </div>
                          <div className="col-span-6">
                            <p className="text-white">
                              {query.query}
                            </p>
                          </div>
                          <div className="col-span-2">
                            <span className="text-gray-300 capitalize text-sm">
                              {query.keyword}
                            </span>
                          </div>
                          <div className="col-span-1">
                            <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-md text-xs font-medium ${getCategoryColor(query.category)}`}>
                              {getCategoryIcon(query.category)}
                              <span>{query.category.charAt(0)}</span>
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                                 
              </div>
            )}

            {/* AI Query Status */}
            {queryState.loading && (
              <div className="text-center py-8">
                <div className="inline-flex items-center space-x-2 text-muted-foreground">
                  <RefreshCw className="h-5 w-5 animate-spin" />
                  <span>AI is finding queries...</span>
                </div>
              </div>
            )}

            {queryState.error && (
              <div className="text-center py-8">
                <div className="text-red-600 mb-4">
                  Failed to find queries: {queryState.error}
                </div>
                <button
                  onClick={generateQueries}
                  className="inline-flex items-center space-x-2 bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors"
                >
                  <RefreshCw className="h-4 w-4" />
                  <span>Try Again</span>
                </button>
              </div>
            )}


          </div>

          {/* Navigation Buttons */}
          <div className="flex justify-between mt-8">
            <button
              onClick={() => router.push('/dashboard/add-brand/step-2')}
              className="flex items-center space-x-2 bg-[#164a54] text-white px-6 py-3 rounded-xl hover:bg-[#1a4a54] transition-colors"
            >
              <ArrowLeft className="h-5 w-5" />
              <span>Back</span>
            </button>

                          <button
                onClick={handleComplete}
                disabled={!queryState.result || queryState.loading || selectedQueries.size < 4 || isCompleting || credits < 100}
                className="flex items-center space-x-2 bg-[#93E85F] text-black px-6 py-3 rounded-xl hover:bg-[#93E85F]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                {isCompleting ? (
                  <>
                    <RefreshCw className="h-5 w-5 animate-spin" />
                    <span>Completing Setup...</span>
                  </>
                ) : credits < 100 ? (
                  <>
                    <span>Insufficient Credits (Need 100)</span>
                    <Check className="h-5 w-5" />
                  </>
                ) : selectedQueries.size < 4 ? (
                  <>
                    <span>Select at least 4 queries to continue ({selectedQueries.size}/4)</span>
                    <Check className="h-5 w-5" />
                  </>
                ) : (
                  <>
                    <span>Complete Setup ({selectedQueries.size} queries, 100 credits)</span>
                    <Check className="h-5 w-5" />
                  </>
                )}
              </button>
          </div>
        </div>
      </div>

      {/* Add Topic Modal */}
      {showAddTopicModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-card border border-border rounded-2xl p-6 w-full max-w-md mx-4 shadow-xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">Add a new topic</h3>
              <button
                onClick={handleCancelTopic}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Modal Content */}
            <div className="space-y-4">
              <p className="text-muted-foreground text-sm">
                Choose a topic that best fits your business area
              </p>

              {/* Input Field */}
              <div>
                <input
                  type="text"
                  value={newTopicName}
                  onChange={(e) => setNewTopicName(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g. Vegan products, Eco-friendly bags"
                  className="w-full px-4 py-3 border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#000C60] focus:border-transparent bg-background text-foreground"
                  autoFocus
                />
              </div>

              {/* Info Message */}
              <div className="flex items-start space-x-2 p-3 bg-muted/30 rounded-lg">
                <AlertCircle className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  Topics are global and will be used across different features of the platform
                </p>
              </div>

              {/* Topic Count */}
              <div className="text-sm text-muted-foreground">
                {totalTopics}/10 topics added
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between mt-6">
              <button
                onClick={handleCancelTopic}
                className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveTopic}
                disabled={!newTopicName.trim() || !canAddMoreTopics}
                className="px-6 py-2 bg-[#8B5CF6] text-white rounded-lg hover:bg-[#8B5CF6]/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Save Topic
              </button>
            </div>
          </div>
        </div>
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
                disabled={!newQuery.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Add Query
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 