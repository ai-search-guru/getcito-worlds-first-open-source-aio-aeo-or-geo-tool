'use client'
import React from 'react';
import { useBrandContext } from '@/context/BrandContext';
import { Activity, Eye, ArrowRight, Clock } from 'lucide-react';
import { UserBrand } from '@/firebase/firestore/getUserBrands';

interface QueriesWidgetProps {
  brandOverride?: UserBrand;
  onViewAll?: () => void;
  className?: string;
}

export default function QueriesWidget({ 
  brandOverride,
  onViewAll,
  className = ''
}: QueriesWidgetProps): React.ReactElement {
  const { selectedBrand } = useBrandContext();
  
  // Use brand override if provided, otherwise use selected brand
  const brand = brandOverride || selectedBrand;
  
  if (!brand) {
    return (
      <div className={`bg-card border border-border rounded-lg p-3 ${className}`}>
        <div className="text-center py-4">
          <Activity className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">No brand selected</p>
        </div>
      </div>
    );
  }

  const queries = brand.queries || [];
  const queryResults = brand.queryProcessingResults || [];
  
  // Calculate processing stats
  const processedCount = queryResults.length;
  const totalQueries = queries.length;
  const processingRate = totalQueries > 0 ? Math.round((processedCount / totalQueries) * 100) : 0;
  
  // Get last processed date
  const lastProcessed = queryResults.length > 0 
    ? new Date(queryResults.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())[0].date)
    : null;

  return (
    <div className={`bg-card border border-border rounded-lg p-3 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Activity className="h-4 w-4 text-[#000C60]" />
          <span className="text-xs font-medium text-foreground">Queries</span>
        </div>
        {onViewAll && (
          <button
            onClick={onViewAll}
            className="text-xs text-[#000C60] hover:text-[#000C60]/80 transition-colors"
          >
            <ArrowRight className="h-3 w-3" />
          </button>
        )}
      </div>

      <div className="space-y-2">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center">
            <p className="text-lg font-bold text-[#000C60]">{totalQueries}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-[#00B087]">{processedCount}</p>
            <p className="text-xs text-muted-foreground">Processed</p>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="space-y-1">
          <div className="flex justify-between items-center">
            <span className="text-xs text-muted-foreground">Progress</span>
            <span className="text-xs font-medium text-foreground">{processingRate}%</span>
          </div>
          <div className="w-full bg-muted rounded-full h-1.5">
            <div 
              className="bg-[#00B087] h-1.5 rounded-full transition-all duration-300" 
              style={{width: `${processingRate}%`}}
            />
          </div>
        </div>

        {/* Last Processed */}
        {lastProcessed && (
          <div className="flex items-center space-x-1 pt-1">
            <Clock className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">
              Last: {lastProcessed.toLocaleDateString()}
            </span>
          </div>
        )}

        {/* Recent Queries Preview */}
        {queries.length > 0 && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs font-medium text-foreground mb-1">Recent</p>
            <div className="space-y-1">
              {queries.slice(0, 2).map((query, index) => {
                const hasResult = queryResults.some(r => r.query === query.query);
                return (
                  <div key={index} className="flex items-center justify-between">
                    <span className="text-xs text-muted-foreground truncate flex-1 mr-2">
                      {query.query.length > 25 ? `${query.query.substring(0, 25)}...` : query.query}
                    </span>
                    {hasResult && <Eye className="h-3 w-3 text-[#00B087]" />}
                  </div>
                );
              })}
              {queries.length > 2 && (
                <div className="text-center pt-1">
                  <span className="text-xs text-muted-foreground">
                    +{queries.length - 2} more
                  </span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 