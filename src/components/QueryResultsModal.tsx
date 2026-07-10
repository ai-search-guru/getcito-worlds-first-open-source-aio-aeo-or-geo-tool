'use client';

import React from 'react';

interface QueryResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  results: {
    success: boolean;
    query: string;
    totalResults: number;
    successfulResults: number;
    totalCost: number;
    totalTime: number;
    summary: {
      chatgptSearch?: {
        content: string;
        webSearchUsed: boolean;
        citations: number;
        responseTime: number;
      };
      googleAiOverview?: {
        totalItems: number;
        peopleAlsoAskCount: number;
        organicResultsCount: number;
        location: string;
        responseTime: number;
      };
      perplexity?: {
        content: string;
        citations: number;
        realTimeData: boolean;
        responseTime: number;
      };
    };
    results: Array<{
      providerId: string;
      status: 'success' | 'error' | 'timeout';
      data?: any;
      error?: string;
      responseTime: number;
      cost: number;
    }>;
  } | null;
}

export default function QueryResultsModal({ isOpen, onClose, results }: QueryResultsModalProps) {
  if (!isOpen || !results) return null;

  const { summary, query, totalCost, totalTime, successfulResults, totalResults } = results;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-4xl max-h-[90vh] overflow-y-auto w-full mx-4">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
            AI Query Results
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Query Info */}
        <div className="mb-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Query:</h3>
          <p className="text-gray-700 dark:text-gray-300 italic">"{query}"</p>
          <div className="mt-3 flex flex-wrap gap-4 text-sm">
            <span className="text-green-600 dark:text-green-400">
              ✅ {successfulResults}/{totalResults} providers successful
            </span>
            <span className="text-blue-600 dark:text-blue-400">
              ⏱️ {totalTime}ms total time
            </span>
            <span className="text-purple-600 dark:text-purple-400">
              💰 ${totalCost.toFixed(4)} total cost
            </span>
          </div>
        </div>

        {/* Provider Results */}
        <div className="space-y-6">
          {/* ChatGPT Search */}
          {summary.chatgptSearch && (
            <div className="border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-blue-800 dark:text-blue-300">
                  🔍 ChatGPT Search
                </h3>
                <div className="flex gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {summary.chatgptSearch.responseTime}ms
                  </span>
                  {summary.chatgptSearch.webSearchUsed && (
                    <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                      Web Search
                    </span>
                  )}
                </div>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                {summary.chatgptSearch.content.substring(0, 300)}...
              </p>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                📚 {summary.chatgptSearch.citations} citations found
              </div>
            </div>
          )}

          {/* Perplexity AI */}
          {summary.perplexity && (
            <div className="border border-purple-200 dark:border-purple-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-purple-800 dark:text-purple-300">
                  🧠 Perplexity AI
                </h3>
                <div className="flex gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {summary.perplexity.responseTime}ms
                  </span>
                  {summary.perplexity.realTimeData && (
                    <span className="bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-1 rounded">
                      Real-time
                    </span>
                  )}
                </div>
              </div>
              <p className="text-gray-700 dark:text-gray-300 mb-2">
                {summary.perplexity.content.substring(0, 300)}...
              </p>
              <div className="text-sm text-gray-600 dark:text-gray-400">
                🔗 {summary.perplexity.citations} citations found
              </div>
            </div>
          )}

          {/* Google AI Overview */}
          {summary.googleAiOverview && (
            <div className="border border-green-200 dark:border-green-700 rounded-lg p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-lg font-semibold text-green-800 dark:text-green-300">
                  📊 Google AI Overview
                </h3>
                <div className="flex gap-3 text-sm">
                  <span className="text-gray-600 dark:text-gray-400">
                    {summary.googleAiOverview.responseTime}ms
                  </span>
                  <span className="bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 px-2 py-1 rounded">
                    SERP Data
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {summary.googleAiOverview.totalItems}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">Total Items</div>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {summary.googleAiOverview.peopleAlsoAskCount}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">People Ask</div>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <div className="font-semibold text-gray-900 dark:text-white">
                    {summary.googleAiOverview.organicResultsCount}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">Organic</div>
                </div>
                <div className="text-center p-2 bg-gray-50 dark:bg-gray-700 rounded">
                  <div className="font-semibold text-gray-900 dark:text-white text-xs">
                    {summary.googleAiOverview.location}
                  </div>
                  <div className="text-gray-600 dark:text-gray-400">Location</div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Performance Summary */}
        <div className="mt-6 p-4 bg-gray-50 dark:bg-gray-700 rounded-lg">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-2">Performance Summary</h3>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="text-center">
              <div className="font-semibold text-gray-900 dark:text-white">
                {Math.round(totalTime / totalResults)}ms
              </div>
              <div className="text-gray-600 dark:text-gray-400">Avg Response</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-gray-900 dark:text-white">
                ${(totalCost / totalResults).toFixed(4)}
              </div>
              <div className="text-gray-600 dark:text-gray-400">Avg Cost</div>
            </div>
            <div className="text-center">
              <div className="font-semibold text-gray-900 dark:text-white">
                {Math.round((successfulResults / totalResults) * 100)}%
              </div>
              <div className="text-gray-600 dark:text-gray-400">Success Rate</div>
            </div>
          </div>
        </div>

        {/* Close Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
} 