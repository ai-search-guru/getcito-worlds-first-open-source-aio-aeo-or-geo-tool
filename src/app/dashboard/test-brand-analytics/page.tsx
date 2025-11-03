'use client'
import React from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import BrandAnalyticsDisplay from '@/components/features/BrandAnalyticsDisplay';
import { useLatestBrandAnalytics, useBrandAnalyticsHistory, useUserAnalyticsSummary } from '@/hooks/useBrandAnalytics';
import { useBrandContext } from '@/context/BrandContext';
import { useAuthContext } from '@/context/AuthContext';
import { RefreshCw } from 'lucide-react';

export default function TestBrandAnalyticsPage(): React.ReactElement {
  const { user } = useAuthContext();
  const { selectedBrand, selectedBrandId } = useBrandContext();
  
  const { 
    analytics: latestAnalytics, 
    loading: latestLoading, 
    error: latestError, 
    refetch: refetchLatest 
  } = useLatestBrandAnalytics(selectedBrandId);
  
  const { 
    history, 
    loading: historyLoading, 
    error: historyError, 
    refetch: refetchHistory 
  } = useBrandAnalyticsHistory(selectedBrandId);
  
  const { 
    summary, 
    loading: summaryLoading, 
    error: summaryError, 
    refetch: refetchSummary 
  } = useUserAnalyticsSummary(user?.uid);

  const handleRefreshAll = () => {
    refetchLatest();
    refetchHistory();
    refetchSummary();
  };

  return (
    <DashboardLayout>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Brand Analytics Test</h1>
            <p className="text-gray-600 mt-1">
              Testing the cumulative brand analytics system
            </p>
          </div>
          <button
            onClick={handleRefreshAll}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            <span>Refresh All</span>
          </button>
        </div>

        {/* Selected Brand Info */}
        {selectedBrand && (
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h3 className="font-semibold text-blue-900">Selected Brand</h3>
            <p className="text-blue-700">
              {selectedBrand.companyName} ({selectedBrand.domain})
            </p>
            <p className="text-sm text-blue-600 mt-1">
              Brand ID: {selectedBrandId}
            </p>
          </div>
        )}

        {/* User Analytics Summary */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900">User Analytics Summary</h3>
          </div>
          <div className="p-6">
            {summaryLoading ? (
              <div className="flex items-center space-x-2 text-gray-600">
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Loading user summary...</span>
              </div>
            ) : summaryError ? (
              <div className="text-red-600">Error: {summaryError}</div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-gray-900">{summary.totalBrands}</div>
                  <div className="text-sm text-gray-600">Total Brands</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-blue-600">{summary.totalBrandMentions}</div>
                  <div className="text-sm text-gray-600">Total Brand Mentions</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">{summary.totalCitations}</div>
                  <div className="text-sm text-gray-600">Total Citations</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-green-600">{summary.averageVisibilityScore.toFixed(1)}%</div>
                  <div className="text-sm text-gray-600">Avg Visibility</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-bold text-orange-600">
                    {summary.topPerformingBrand?.brandName || 'None'}
                  </div>
                  <div className="text-sm text-gray-600">Top Brand</div>
                </div>
              </div>
            )}
            {summary.lastUpdated && (
              <div className="mt-4 pt-4 border-t border-gray-100 text-sm text-gray-600">
                <span className="font-medium">Last Updated:</span> {summary.lastUpdated}
              </div>
            )}
          </div>
        </div>

        {/* Latest Analytics */}
        {selectedBrandId && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Latest Brand Analytics</h3>
            {latestLoading ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center space-x-2 text-gray-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading latest analytics...</span>
                </div>
              </div>
            ) : latestError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-red-600">Error: {latestError}</div>
              </div>
            ) : latestAnalytics ? (
              <BrandAnalyticsDisplay analytics={latestAnalytics} />
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <p className="text-gray-600">No analytics data available for this brand.</p>
                <p className="text-sm text-gray-500 mt-2">
                  Process some queries first to generate analytics data.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Analytics History */}
        {selectedBrandId && (
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Analytics History & Trends</h3>
            {historyLoading ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                <div className="flex items-center space-x-2 text-gray-600">
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Loading analytics history...</span>
                </div>
              </div>
            ) : historyError ? (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="text-red-600">Error: {historyError}</div>
              </div>
            ) : history ? (
              <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100">
                  <h4 className="font-semibold text-gray-900">Trend Analysis</h4>
                </div>
                <div className="p-6">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${
                        history.trend.brandMentionsChange > 0 ? 'text-green-600' : 
                        history.trend.brandMentionsChange < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {history.trend.brandMentionsChange > 0 ? '+' : ''}{history.trend.brandMentionsChange}
                      </div>
                      <div className="text-sm text-gray-600">Brand Mentions Change</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${
                        history.trend.citationsChange > 0 ? 'text-green-600' : 
                        history.trend.citationsChange < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {history.trend.citationsChange > 0 ? '+' : ''}{history.trend.citationsChange}
                      </div>
                      <div className="text-sm text-gray-600">Citations Change</div>
                    </div>
                    <div className="text-center">
                      <div className={`text-2xl font-bold ${
                        history.trend.visibilityChange > 0 ? 'text-green-600' : 
                        history.trend.visibilityChange < 0 ? 'text-red-600' : 'text-gray-600'
                      }`}>
                        {history.trend.visibilityChange > 0 ? '+' : ''}{history.trend.visibilityChange.toFixed(1)}%
                      </div>
                      <div className="text-sm text-gray-600">Visibility Change</div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">Total Sessions:</span> {history.totalSessions}
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                <p className="text-gray-600">No analytics history available.</p>
              </div>
            )}
          </div>
        )}

        {!selectedBrandId && (
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
            <p className="text-yellow-800">Please select a brand to view analytics data.</p>
          </div>
        )}
      </div>
    </DashboardLayout>
  );
} 