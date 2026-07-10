'use client'
import React, { useEffect, useCallback } from "react";
import { useAuthContext } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { Shield, Link as LinkIcon, MessageSquare, Heart, BarChart3, Zap, RefreshCw, AlertCircle } from 'lucide-react';
import Link from 'next/link';

import DashboardLayout from '@/components/layout/DashboardLayout';
import MetricCard from '@/components/features/MetricCard';
import LeaderboardTable from '@/components/features/LeaderboardTable';
import RecommendationSection from '@/components/features/RecommendationSection';
import TopDomains from '@/components/features/TopDomains';
import TrendCharts from '@/components/features/TrendCharts';
import Card from '@/components/shared/Card';
import BrandTrackingModal from '@/components/shared/BrandTrackingModal';
import ProcessQueriesButton from '@/components/features/ProcessQueriesButton';
import QueriesOverview from '@/components/features/QueriesOverview';
import { useDashboardData } from '@/hooks/useDashboardData';
import { seedAllData } from '@/firebase/firestore/seedData';
import { useBrandContext } from '@/context/BrandContext';
import { UserBrand } from '@/firebase/firestore/getUserBrands';
import { useUserBrands } from '@/hooks/useUserBrands';

// Mock data - in real app this would come from API
const metricsData = [
  {
    title: "Brand Validity",
    value: "94.2%",
    change: 5.3,
    changeLabel: "vs last month",
    icon: Shield,
    color: "green" as const,
    description: "Accuracy of brand mentions"
  },
  {
    title: "Link Validity", 
    value: "87.8%",
    change: -2.1,
    changeLabel: "vs last month", 
    icon: LinkIcon,
    color: "blue" as const,
    description: "Valid reference links"
  },
  {
    title: "Brand Mentions",
    value: "1,247",
    change: 12.5,
    changeLabel: "vs last month",
    icon: MessageSquare,
    color: "yellow" as const,
    description: "Total mentions tracked"
  },
  {
    title: "Sentiment Analysis",
    value: "8.6/10",
    change: 0.8,
    changeLabel: "vs last month",
    icon: Heart,
    color: "green" as const,
    description: "Average sentiment score"
  }
];

const leaderboardData = [
  { rank: 1, brand: "OpenAI", domain: "openai.com", mentions: 15420, visibility: 94, change: 12.3, sentiment: "positive" as const },
  { rank: 2, brand: "Google", domain: "google.com", mentions: 12890, visibility: 87, change: 8.7, sentiment: "positive" as const },
  { rank: 3, brand: "Microsoft", domain: "microsoft.com", mentions: 11200, visibility: 82, change: -2.1, sentiment: "neutral" as const },
  { rank: 4, brand: "Anthropic", domain: "anthropic.com", mentions: 8950, visibility: 76, change: 15.4, sentiment: "positive" as const },
  { rank: 5, brand: "Meta", domain: "meta.com", mentions: 7650, visibility: 71, change: -5.3, sentiment: "negative" as const },
  { rank: 6, brand: "Apple", domain: "apple.com", mentions: 6420, visibility: 68, change: 3.2, sentiment: "positive" as const }
];

const brandPromptsData = [
  { rank: 1, brand: "ChatGPT Integration", domain: "chat.openai.com", mentions: 892, visibility: 89, change: 24.1, sentiment: "positive" as const },
  { rank: 2, brand: "AI Assistant Features", domain: "assistant.google.com", mentions: 745, visibility: 82, change: 18.7, sentiment: "positive" as const },
  { rank: 3, brand: "Machine Learning APIs", domain: "cloud.google.com", mentions: 634, visibility: 76, change: -3.2, sentiment: "neutral" as const },
  { rank: 4, brand: "Natural Language Processing", domain: "huggingface.co", mentions: 521, visibility: 71, change: 9.8, sentiment: "positive" as const },
  { rank: 5, brand: "Deep Learning Models", domain: "pytorch.org", mentions: 456, visibility: 65, change: 7.2, sentiment: "positive" as const },
  { rank: 6, brand: "Neural Networks", domain: "tensorflow.org", mentions: 389, visibility: 58, change: -1.5, sentiment: "neutral" as const }
];

const recommendationsData = [
  {
    id: "1",
    title: "Optimize brand mentions in ChatGPT responses",
    description: "Increase your brand visibility by 23% through strategic content optimization and keyword targeting.",
    priority: "high" as const,
    category: "Content Strategy",
    imageUrl: "https://picsum.photos/400/300?random=10",
    readTime: "5 min read",
    rating: 4.8
  },
  {
    id: "2", 
    title: "Improve sentiment analysis on Perplexity",
    description: "Address negative sentiment patterns detected in recent brand mentions to improve overall rating.",
    priority: "medium" as const,
    category: "Reputation Management",
    imageUrl: "https://picsum.photos/400/300?random=11",
    readTime: "3 min read",
    rating: 4.2
  },
  {
    id: "3",
    title: "Expand competitor analysis coverage",
    description: "Track 12 additional competitors to get more comprehensive market intelligence.",
    priority: "low" as const,
    category: "Market Intelligence",
    imageUrl: "https://picsum.photos/400/300?random=12",
    readTime: "7 min read",
    rating: 4.5
  }
];

const topDomainsData = [
  { rank: 1, domain: "www.zeni.ai", mentions: 6, progress: 90, icon: "⚡" },
  { rank: 2, domain: "mercury.com", mentions: 5, progress: 75, icon: "▪️" },
  { rank: 3, domain: "affoweb.com", mentions: 4, progress: 60, icon: "🔺" },
  { rank: 4, domain: "kruzeconsulting.c...", mentions: 4, progress: 85, icon: "📊" },
  { rank: 5, domain: "topapps.ai", mentions: 3, progress: 50, icon: "⚫" },
  { rank: 6, domain: "www.codemasters...", mentions: 3, progress: 45, icon: "⚪" },
  { rank: 7, domain: "www.freshbooks.c...", mentions: 3, progress: 65, icon: "🔷" },
  { rank: 8, domain: "www.phoenixstrat...", mentions: 3, progress: 70, icon: "🔶" }
];

function Page(): React.ReactElement {
  const { user, loading: authLoading } = useAuthContext();
  const router = useRouter();
  const { 
    data, 
    loading: dataLoading, 
    error, 
    refetch, 
    isGeneratingData, 
    generationStatus 
  } = useDashboardData();
  const { selectedBrand, selectedBrandId, brands, loading: brandsLoading, error: brandsError, setSelectedBrandId, clearBrandContext } = useBrandContext();
  const { refetch: refetchBrands } = useUserBrands();
  
  // Modal state
  const [showTrackingModal, setShowTrackingModal] = React.useState(false);
  const [newBrandName, setNewBrandName] = React.useState('');
  const [newBrandId, setNewBrandId] = React.useState('');

  useEffect(() => {
    // Only redirect if not loading and user is null
    if (!authLoading && user == null) {
      router.push("/");
    }
  }, [user, authLoading, router]);

  // Check for brand tracking modal when dashboard loads
  useEffect(() => {
    if (user && !authLoading) {
      // Check if we should show the brand tracking modal
      const showModal = sessionStorage.getItem('showBrandTrackingModal');
      const brandName = sessionStorage.getItem('newBrandName');
      
      if (showModal === 'true') {
        console.log('🎯 Showing brand tracking modal for:', brandName);
        setNewBrandName(brandName || '');
        const brandId = sessionStorage.getItem('newBrandId');
        setNewBrandId(brandId || '');
        setShowTrackingModal(true);
        
        // Clear the modal flag (but keep other data for when user clicks "Start Tracking")
        sessionStorage.removeItem('showBrandTrackingModal');
      }
    }
  }, [user, authLoading]);

  // Handle "Great, Start Tracking!" button click
  const handleStartTracking = async () => {
    console.log('🚀 Starting brand tracking...');
    
    // Close modal first
    setShowTrackingModal(false);
    
    // Clear current brand context to ensure fresh state
    clearBrandContext();
    
    // Clear current selection and refresh brands
    setSelectedBrandId('');
    
    // Refresh brands list and auto-select new brand
    console.log('🔄 Refreshing brands list...');
    await refetchBrands();
    
    if (newBrandId) {
      console.log('✅ Auto-selecting newly created brand:', newBrandId);
      setTimeout(() => {
        setSelectedBrandId(newBrandId);
      }, 100); // Small delay to ensure brands are loaded
    }
    
    // Clean up remaining session storage
    sessionStorage.removeItem('newBrandId');
    sessionStorage.removeItem('newBrandName');
    sessionStorage.removeItem('firestoreDocId');
    sessionStorage.removeItem('brandsbasicData');
    sessionStorage.removeItem('generatedQueries');
    
    console.log('✅ Brand tracking started successfully!');
    
    // Redirect to queries page
    console.log('🎯 Redirecting to queries page...');
    router.push('/dashboard/queries');
  };

  // Handle modal close
  const handleCloseModal = () => {
    setShowTrackingModal(false);
    
    // Clean up session storage
    sessionStorage.removeItem('newBrandId');
    sessionStorage.removeItem('newBrandName');
    sessionStorage.removeItem('firestoreDocId');
    sessionStorage.removeItem('brandsbasicData');
    sessionStorage.removeItem('generatedQueries');
  };

  // Function to seed data for development
  const handleSeedData = useCallback(async () => {
    if (user?.uid) {
      const result = await seedAllData(user.uid);
      if (result.success) {
        console.log('✅ Sample data seeded successfully!');
        refetch(); // Refresh the data after seeding
      } else {
        console.error('❌ Failed to seed sample data:', result.error);
      }
    }
  }, [user?.uid, refetch]);

  // Developer keyboard shortcut for seeding data (Ctrl+Shift+S)
  useEffect(() => {
    if (process.env.NODE_ENV === 'development') {
      const handleKeyDown = (event: KeyboardEvent) => {
        if (event.ctrlKey && event.shiftKey && event.key === 'S') {
          event.preventDefault();
          handleSeedData();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [user?.uid, handleSeedData]);

  // Expose seed function to global scope for development
  useEffect(() => {
    if (process.env.NODE_ENV === 'development' && user?.uid) {
      (window as any).seedSampleData = handleSeedData;
      (window as any).refreshDashboard = refetch;
      (window as any).debugDashboard = () => {
        console.log('🔍 Dashboard Debug Info:', {
          user: user?.uid,
          selectedBrand: selectedBrand?.companyName,
          selectedBrandId,
          hasBasicData: !!selectedBrand?.brandsbasicData,
          brandsbasicData: selectedBrand?.brandsbasicData,
          metricsCount: data.metrics.length,
          dataLoading,
          error,
          data
        });
      };
      console.log('🔧 Developer tools available:');
      console.log('- seedSampleData() - Populate database with sample data');
      console.log('- refreshDashboard() - Refresh dashboard data');
      console.log('- debugDashboard() - Show debug information');
      console.log('- Ctrl+Shift+S - Keyboard shortcut to seed data');
      
      // Test context availability
      console.log('🧪 Context Test:', {
        brandsLoaded: brands.length > 0,
        selectedBrandId,
        selectedBrandName: selectedBrand?.companyName,
        contextWorking: 'Brand context is working!'
      });
    }
  }, [user?.uid, handleSeedData, refetch, selectedBrand, selectedBrandId, data, dataLoading, error, brands]);

  // Show loading while auth state is being determined
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Loading dashboard...</div>
      </div>
    );
  }

  // Redirect is handled by useEffect, but return loading while redirecting
  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-foreground text-lg">Redirecting...</div>
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Brand Context Information */}
        {selectedBrand && (
          <div className="bg-[#000C60]/5 border border-[#000C60]/20 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-2 h-2 bg-[#00B087] rounded-full"></div>
                <p className="text-[#000C60] text-sm">
                  Showing data for: <span className="font-semibold">{selectedBrand.companyName}</span>
                  {selectedBrand.domain && (
                    <span className="text-muted-foreground ml-2">({selectedBrand.domain})</span>
                  )}
                </p>
              </div>
              {selectedBrand.brandsbasicData && (
                <div className="flex items-center space-x-2 text-xs text-muted-foreground">
                  <span>Last updated: {new Date(selectedBrand.brandsbasicData.lastUpdated).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Enhanced Brand Context Information */}
        <div className="bg-gradient-to-r from-[#000C60]/10 to-[#00B087]/10 border border-[#000C60]/30 rounded-xl p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#000C60]">Current Brand Context</h2>
            <div className="flex items-center space-x-2">
              <div className={`w-3 h-3 rounded-full ${selectedBrand ? 'bg-green-500' : 'bg-gray-400'}`}></div>
              <span className="text-sm font-medium text-muted-foreground">
                {selectedBrand ? 'Brand Selected' : 'No Brand Selected'}
              </span>
            </div>
          </div>

          {/* Debug Information */}
          {process.env.NODE_ENV === 'development' && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 mb-4">
              <p className="text-xs font-medium text-yellow-800 mb-2">Debug Info:</p>
              <div className="text-xs text-yellow-700 space-y-1">
                <p>selectedBrandId: {selectedBrandId || 'null'}</p>
                <p>selectedBrand: {selectedBrand ? selectedBrand.companyName : 'null'}</p>
                <p>brands.length: {brands.length}</p>
                <p>brandsLoading: {brandsLoading ? 'true' : 'false'}</p>
                <p>brandsError: {brandsError || 'null'}</p>
                {brands.length > 0 && (
                  <p>Available brands: {brands.map((b: UserBrand) => `${b.companyName}(${b.id})`).join(', ')}</p>
                )}
              </div>
              {brands.length > 0 && (
                <div className="mt-3 pt-3 border-t border-yellow-300">
                  <p className="text-xs font-medium text-yellow-800 mb-2">Test Brand Selection:</p>
                  <div className="flex flex-wrap gap-2">
                    {brands.map((brand: UserBrand) => (
                      <button
                        key={brand.id}
                        onClick={() => {
                          console.log('🧪 Manual brand selection test:', brand.id, brand.companyName);
                          setSelectedBrandId(brand.id);
                        }}
                        className={`px-2 py-1 text-xs rounded border ${
                          selectedBrandId === brand.id 
                            ? 'bg-blue-500 text-white border-blue-600' 
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        {brand.companyName}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-3 pt-3 border-t border-yellow-300">
                <p className="text-xs font-medium text-yellow-800 mb-2">Debug Actions:</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      console.log('🔄 Manual brands refetch triggered');
                      refetchBrands();
                    }}
                    className="px-2 py-1 text-xs rounded border bg-green-500 text-white border-green-600 hover:bg-green-600"
                  >
                    Refetch Brands
                  </button>
                  <button
                    onClick={() => {
                      console.log('🧹 Clearing localStorage selectedBrandId');
                      localStorage.removeItem('selectedBrandId');
                      window.location.reload();
                    }}
                    className="px-2 py-1 text-xs rounded border bg-red-500 text-white border-red-600 hover:bg-red-600"
                  >
                    Clear & Reload
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {selectedBrand ? (
            <div className="space-y-4">
              {/* Brand Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white/50 rounded-lg p-3 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Company Name</p>
                  <p className="text-sm font-semibold text-[#000C60]">{selectedBrand.companyName}</p>
                </div>
                <div className="bg-white/50 rounded-lg p-3 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Domain</p>
                  <p className="text-sm font-semibold text-[#000C60]">{selectedBrand.domain || 'Not provided'}</p>
                </div>
                <div className="bg-white/50 rounded-lg p-3 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Brand ID</p>
                  <p className="text-sm font-mono text-[#000C60] truncate">{selectedBrandId}</p>
                </div>
                <div className="bg-white/50 rounded-lg p-3 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Analytics Data</p>
                  <p className={`text-sm font-semibold ${selectedBrand.brandsbasicData ? 'text-green-600' : 'text-orange-600'}`}>
                    {selectedBrand.brandsbasicData ? 'Available' : 'Pending Setup'}
                  </p>
                </div>
              </div>

              {/* Additional Brand Details */}
              {selectedBrand.shortDescription && (
                <div className="bg-white/50 rounded-lg p-3 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Description</p>
                  <p className="text-sm text-[#000C60]">{selectedBrand.shortDescription}</p>
                </div>
              )}

              {/* Analytics Data Status */}
              {selectedBrand.brandsbasicData && (
                <div className="bg-white/50 rounded-lg p-4 border border-[#000C60]/10">
                  <p className="text-xs font-medium text-muted-foreground mb-3">Analytics Summary</p>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-[#00B087]">{selectedBrand.brandsbasicData.brandMentions}</p>
                      <p className="text-xs text-muted-foreground">Brand Mentions</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-[#000C60]">{selectedBrand.brandsbasicData.brandValidity}%</p>
                      <p className="text-xs text-muted-foreground">Brand Validity</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-[#764F94]">{selectedBrand.brandsbasicData.linkValidity}%</p>
                      <p className="text-xs text-muted-foreground">Link Validity</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-[#FF6B6B]">{selectedBrand.brandsbasicData.sentimentScore}/10</p>
                      <p className="text-xs text-muted-foreground">Sentiment Score</p>
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[#000C60]/10">
                    <p className="text-xs text-muted-foreground">
                      Last Updated: {new Date(selectedBrand.brandsbasicData.lastUpdated).toLocaleString()}
                    </p>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <AlertCircle className="h-8 w-8 text-gray-400" />
              </div>
              <p className="text-lg font-semibold text-gray-600 mb-2">No Brand Selected</p>
              <p className="text-sm text-muted-foreground mb-4">
                Please select a brand from the sidebar to view detailed analytics and performance metrics.
              </p>
              <p className="text-xs text-muted-foreground">
                If you don't have any brands yet, you can <strong>Add a Brand</strong> from the sidebar navigation.
              </p>
            </div>
          )}
        </div>

        {/* Data Generation Status */}
        {isGeneratingData && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center">
              <RefreshCw className="h-5 w-5 text-blue-600 mr-2 animate-spin" />
              <p className="text-blue-800">
                Generating brand data: {generationStatus}
              </p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4">
            <div className="flex items-center">
              <AlertCircle className="h-5 w-5 text-red-600 mr-2" />
              <p className="text-red-800">{error}</p>
              <button
                onClick={refetch}
                className="ml-auto flex items-center text-red-600 hover:text-red-800"
              >
                <RefreshCw className="h-4 w-4 mr-1" />
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Development Seed Data Button - Only show if no data exists */}
        {process.env.NODE_ENV === 'development' && 
         !dataLoading && 
         data.metrics.length === 0 && 
         data.leaderboard.length === 0 && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-800 text-sm font-medium">No data found</p>
                <p className="text-blue-600 text-xs">Populate with sample data for testing?</p>
              </div>
              <button
                onClick={handleSeedData}
                className="bg-blue-600 text-white px-3 py-1.5 text-sm rounded hover:bg-blue-700 transition-colors"
              >
                Add Sample Data
              </button>
            </div>
          </div>
        )}

        {/* Loading State */}
        {dataLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-6 animate-pulse">
                <div className="h-4 bg-muted rounded w-3/4 mb-4"></div>
                <div className="h-8 bg-muted rounded w-1/2 mb-2"></div>
                <div className="h-3 bg-muted rounded w-full"></div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {/* No Brand Selected Message */}
            {!selectedBrand && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <div className="flex items-center">
                  <AlertCircle className="h-5 w-5 text-yellow-600 mr-2" />
                  <p className="text-yellow-800">
                    Please select a brand from the sidebar to view analytics data.
                  </p>
                </div>
              </div>
            )}



            {/* KPI Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
              {(() => {
                console.log('🔍 Dashboard rendering state:', {
                  hasMetrics: data.metrics.length > 0,
                  metricsCount: data.metrics.length,
                  selectedBrand: selectedBrand?.companyName,
                  selectedBrandId,
                  hasBasicData: !!selectedBrand?.brandsbasicData,
                  dataLoading,
                  metricsData: data.metrics
                });
                return null;
              })()}
              {false && data.metrics.length > 0 ? (
                // Show real brand analytics data
                data.metrics.map((metric, index) => (
                <MetricCard
                  key={index}
                  title={metric.title}
                  value={metric.value}
                  change={metric.change}
                  changeLabel={metric.changeLabel}
                  icon={[Shield, LinkIcon, MessageSquare, Heart][index] || Shield}
                  color={metric.color}
                  description={metric.description}
                />
                ))
              ) : selectedBrand ? (
                // If brand is selected but no analytics data, show "No data available" cards
                [
                  { title: "Brand Validity", icon: Shield, description: "Accuracy of brand mentions" },
                  { title: "Link Validity", icon: LinkIcon, description: "Valid reference links" },
                  { title: "Brand Mentions", icon: MessageSquare, description: "Total mentions tracked" },
                  { title: "Sentiment Analysis", icon: Heart, description: "Average sentiment score" }
                ].map((metric, index) => (
                  <MetricCard
                    key={index}
                    title={metric.title}
                    value="No data available"
                    change={undefined}
                    changeLabel="Complete brand setup"
                    icon={metric.icon}
                    color="gray"
                    description={metric.description}
                  />
                ))
              ) : (
                // If no brand selected, show demo data
                metricsData.map((metric, index) => (
                <MetricCard
                  key={index}
                  title={metric.title}
                  value={metric.value}
                  change={metric.change}
                  changeLabel={metric.changeLabel}
                  icon={metric.icon}
                  color={metric.color}
                  description={metric.description}
                />
                ))
              )}
            </div>

            {/* Debug: Always show test cards */}
            {process.env.NODE_ENV === 'development' && (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-foreground mb-2">Debug Card 1</h3>
                    <p className="text-muted-foreground">This card should always be visible</p>
                  </div>
                </div>
                <div className="bg-card border border-border rounded-xl p-6">
                  <div className="text-center">
                    <h3 className="text-lg font-semibold text-foreground mb-2">Debug Card 2</h3>
                    <p className="text-muted-foreground">Testing rendering</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {!dataLoading && (
          <>
            {/* AI Recommendations */}
            <RecommendationSection 
              recommendations={data.recommendations.length > 0 ? data.recommendations : recommendationsData}
              defaultExpanded={true}
            />

            {/* Trend Charts */}
            <TrendCharts />

            {/* Recent Queries Overview */}
            <QueriesOverview 
              variant="compact"
              maxQueries={5}
              showProcessButton={true}
              showSearch={false}
              showEyeIcons={true}
              onViewAll={() => {
                // Navigate to queries page
                window.location.href = '/dashboard/queries';
              }}
              onQueryClick={(query, result) => {
                console.log('Dashboard: Query clicked', query, result);
                // Could open a quick modal or navigate to detail view
              }}
            />

            {/* Tables Section - 2 columns */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Visibility Leaderboard */}
              <LeaderboardTable
                title="Visibility Leaderboard"
                data={data.leaderboard.length > 0 ? data.leaderboard : leaderboardData}
                showSentiment={true}
              />

              {/* Top Referenced Domains - NEW */}
              <TopDomains data={data.topDomains.length > 0 ? data.topDomains : topDomainsData} />
            </div>

            {/* Brand Prompts Analysis - Full Width */}
            <div>
              <LeaderboardTable
                title="Brand Prompts Analysis"
                data={data.brandPrompts.length > 0 ? data.brandPrompts : brandPromptsData}
                showSentiment={false}
              />
            </div>
          </>
        )}

        {/* Additional Sections - Now 2 columns instead of 3 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Quick Actions */}
          <Card>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">Quick Actions</h3>
              <Zap className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-3">
              <button className="w-full text-left p-3 border border-border rounded-lg hover:border-accent transition-colors">
                <p className="text-foreground font-medium">Export Monthly Report</p>
                <p className="text-muted-foreground text-sm">Download comprehensive analytics</p>
              </button>
              <button className="w-full text-left p-3 border border-border rounded-lg hover:border-accent transition-colors">
                <p className="text-foreground font-medium">Configure Alerts</p>
                <p className="text-muted-foreground text-sm">Set up brand mention notifications</p>
              </button>
              <Link href="/dashboard/add-brand/step-1" className="w-full text-left p-3 border border-border rounded-lg hover:border-accent transition-colors block">
                <p className="text-foreground font-medium">Add New Brand</p>
                <p className="text-muted-foreground text-sm">Start tracking additional brands</p>
              </Link>
              <div className="w-full">
                <ProcessQueriesButton 
                  variant="secondary"
                  size="md"
                  className="w-full"
                  onComplete={(result) => {
                    console.log('Dashboard: Queries processed', result);
                  }}
                />
              </div>
            </div>
          </Card>

          {/* Performance Overview */}
          <Card>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-foreground">Performance Overview</h3>
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="space-y-4">
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground text-sm">Brand Visibility</span>
                  <span className="text-foreground text-sm">94%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-[#00B087] h-2 rounded-full" style={{width: '94%'}}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground text-sm">Sentiment Score</span>
                  <span className="text-foreground text-sm">8.6/10</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-[#000C60] h-2 rounded-full" style={{width: '86%'}}></div>
                </div>
              </div>
              <div>
                <div className="flex justify-between items-center mb-2">
                  <span className="text-muted-foreground text-sm">Response Accuracy</span>
                  <span className="text-foreground text-sm">92%</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="bg-[#764F94] h-2 rounded-full" style={{width: '92%'}}></div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Brand Tracking Modal */}
      <BrandTrackingModal
        isOpen={showTrackingModal}
        onStartTracking={handleStartTracking}
        onClose={handleCloseModal}
        brandName={newBrandName}
      />
    </DashboardLayout>
  );
}

export default Page; 