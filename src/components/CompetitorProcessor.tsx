'use client'
import React from 'react';
import { useCompetitorAnalytics, ProcessingState } from '@/hooks/useCompetitorAnalytics';
import { Users, TrendingUp, BarChart3, RefreshCw, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';

interface CompetitorProcessorProps {
  brandId?: string;
  brandName?: string;
  onProcessingComplete?: () => void;
  onProcessingStart?: () => void;
  className?: string;
}

export default function CompetitorProcessor({
  brandId,
  brandName,
  onProcessingComplete,
  onProcessingStart,
  className = ''
}: CompetitorProcessorProps): React.ReactElement {
  const { state, progress } = useCompetitorAnalytics();

  const getStatusIcon = () => {
    switch (state) {
      case 'processing':
        return <Loader2 className="h-5 w-5 animate-spin text-blue-500" />;
      case 'completed':
        return <CheckCircle className="h-5 w-5 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      default:
        return <BarChart3 className="h-5 w-5 text-gray-500" />;
    }
  };

  const getStatusColor = () => {
    switch (state) {
      case 'processing':
        return 'border-blue-200 bg-blue-50';
      case 'completed':
        return 'border-green-200 bg-green-50';
      case 'error':
        return 'border-red-200 bg-red-50';
      default:
        return 'border-gray-200 bg-gray-50';
    }
  };

  const getStatusMessage = () => {
    switch (state) {
      case 'processing':
        return `Processing competitor analytics... (${progress.processedQueries}/${progress.totalQueries})`;
      case 'completed':
        return `Competitor analysis completed for ${progress.totalQueries} queries`;
      case 'error':
        return `Error: ${progress.error || 'Failed to process competitor analytics'}`;
      default:
        return 'Ready for analysis';
    }
  };

  const getProgressPercentage = () => {
    if (progress.totalQueries === 0) return 0;
    return Math.round((progress.processedQueries / progress.totalQueries) * 100);
  };

  return (
    <div className={`border rounded-xl p-6 ${getStatusColor()} ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-white rounded-lg shadow-sm">
            <Users className="h-6 w-6 text-purple-600" />
          </div>
          <div>
            <h3 className="text-lg font-semibold text-gray-900">Competitive Analysis</h3>
            <p className="text-sm text-gray-600">
              {brandName ? `Track competitive landscape for ${brandName}` : 'Real-time competitive intelligence'}
            </p>
          </div>
        </div>
        {getStatusIcon()}
      </div>

      {/* Status Message */}
      <div className="mb-4">
        <p className="text-sm font-medium text-gray-700">{getStatusMessage()}</p>
        {progress.lastProcessedAt && (
          <p className="text-xs text-gray-500 mt-1">
            Last updated: {progress.lastProcessedAt.toLocaleString()}
          </p>
        )}
      </div>

      {/* Progress Bar */}
      {state === 'processing' && progress.totalQueries > 0 && (
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-700">Progress</span>
            <span className="text-sm text-gray-600">{getProgressPercentage()}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-500 h-2 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${getProgressPercentage()}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500 mt-1">
            <span>{progress.processedQueries} processed</span>
            <span>{progress.totalQueries - progress.processedQueries} remaining</span>
          </div>
        </div>
      )}

      {/* Processing Details */}
      {state === 'processing' && (
        <div className="bg-white rounded-lg p-4 border border-blue-200">
          <div className="flex items-center space-x-2 mb-2">
            <div className="animate-pulse w-2 h-2 bg-blue-500 rounded-full"></div>
            <span className="text-sm font-medium text-blue-700">Analyzing Competitors</span>
          </div>
          <ul className="text-xs text-blue-600 space-y-1">
            <li>• Scanning AI responses for competitor mentions</li>
            <li>• Matching competitor names and aliases</li>
            <li>• Calculating visibility scores and market position</li>
            <li>• Generating competitive intelligence insights</li>
          </ul>
        </div>
      )}

      {/* Completion Summary */}
      {state === 'completed' && (
        <div className="bg-white rounded-lg p-4 border border-green-200">
          <div className="flex items-center space-x-2 mb-2">
            <CheckCircle className="h-4 w-4 text-green-500" />
            <span className="text-sm font-medium text-green-700">Analysis Complete</span>
          </div>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div>
              <span className="text-gray-500">Queries Analyzed:</span>
              <div className="font-semibold text-gray-900">{progress.totalQueries}</div>
            </div>
            <div>
              <span className="text-gray-500">Processing Time:</span>
              <div className="font-semibold text-gray-900">
                {progress.lastProcessedAt ? 
                  `${Math.round((new Date().getTime() - progress.lastProcessedAt.getTime()) / 1000)}s` : 
                  'N/A'
                }
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Details */}
      {state === 'error' && (
        <div className="bg-white rounded-lg p-4 border border-red-200">
          <div className="flex items-center space-x-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-500" />
            <span className="text-sm font-medium text-red-700">Processing Failed</span>
          </div>
          <p className="text-xs text-red-600">{progress.error}</p>
          <button 
            className="mt-2 px-3 py-1 bg-red-100 text-red-700 text-xs rounded-lg hover:bg-red-200 transition-colors"
            onClick={() => window.location.reload()}
          >
            <RefreshCw className="h-3 w-3 inline mr-1" />
            Retry Analysis
          </button>
        </div>
      )}

      {/* Idle State Call-to-Action */}
      {state === 'idle' && (
        <div className="bg-white rounded-lg p-4 border border-gray-200">
          <div className="text-center">
            <TrendingUp className="h-8 w-8 text-gray-400 mx-auto mb-2" />
            <p className="text-sm text-gray-600 mb-3">
              Ready to analyze competitive landscape
            </p>
            <div className="text-xs text-gray-500">
              Analysis updates during query processing
            </div>
          </div>
        </div>
      )}
    </div>
  );
} 