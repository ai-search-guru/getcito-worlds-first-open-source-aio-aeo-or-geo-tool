'use client'
import React from 'react';
import { LucideIcon, TrendingUp, TrendingDown, Info } from 'lucide-react';
import Card from '@/components/shared/Card';

interface MetricCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon: LucideIcon;
  color?: 'blue' | 'green' | 'red' | 'yellow' | 'purple' | 'gray';
  description?: string;
}

export default function MetricCard({
  title,
  value,
  change,
  changeLabel,
  icon: Icon,
  color = 'blue',
  description
}: MetricCardProps): React.ReactElement {
  const isPositiveChange = change && change > 0;
  const isNegativeChange = change && change < 0;

  const colorClasses = {
    blue: {
      bg: 'bg-gradient-to-br from-[#000C60] to-[#000C60]',
      text: 'text-[#000C60]',
      accent: 'bg-[#000C60]/10'
    },
    green: {
      bg: 'bg-gradient-to-br from-[#00B087] to-[#00A078]',
      text: 'text-[#00B087]',
      accent: 'bg-[#00B087]/10'
    },
    red: {
      bg: 'bg-gradient-to-br from-[#FF4D4D] to-[#E63946]',
      text: 'text-[#FF4D4D]',
      accent: 'bg-[#FF4D4D]/10'
    },
    yellow: {
      bg: 'bg-gradient-to-br from-[#764F94] to-[#764F94]',
      text: 'text-[#764F94]',
      accent: 'bg-[#764F94]/10'
    },
    purple: {
      bg: 'bg-gradient-to-br from-[#6F42C1] to-[#5A2D91]',
      text: 'text-[#6F42C1]',
      accent: 'bg-[#6F42C1]/10'
    },
    gray: {
      bg: 'bg-gradient-to-br from-[#6B7280] to-[#4B5563]',
      text: 'text-[#6B7280]',
      accent: 'bg-[#6B7280]/10'
    },
  };

  return (
    <Card className="relative overflow-hidden group hover:shadow-lg hover:shadow-black/25 transition-all duration-300" variant="elevated">
      {/* Background accent */}
      <div className={`absolute inset-0 ${colorClasses[color].accent} opacity-0 group-hover:opacity-100 transition-opacity duration-300`} />
      
      {/* Content */}
      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start space-x-3">
            <div className={`p-3 ${colorClasses[color].bg} rounded-xl shadow-lg`}>
              <Icon className="h-6 w-6 text-white" />
            </div>
            <div className="flex-1">
              <h3 className="text-muted-foreground text-sm font-medium mb-1">{title}</h3>
              {description && (
                <div className="flex items-center space-x-1">
                  <Info className="h-3 w-3 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs">{description}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Value */}
        <div className="mb-4">
          <span className={`text-3xl font-bold tracking-tight ${
            value === "No data available" 
              ? "text-muted-foreground text-xl" 
              : "text-foreground"
          }`}>
            {value}
          </span>
        </div>

        {/* Change indicator */}
        {change !== undefined ? (
          <div className="flex items-center justify-between">
            <div className={`flex items-center space-x-2 px-3 py-1 rounded-full ${
              isPositiveChange 
                ? 'bg-[#00B087]/10 text-[#00B087]' 
                : isNegativeChange 
                ? 'bg-[#FF4D4D]/10 text-[#FF4D4D]' 
                : 'bg-muted/50 text-muted-foreground'
            }`}>
              {isPositiveChange && <TrendingUp className="h-4 w-4" />}
              {isNegativeChange && <TrendingDown className="h-4 w-4" />}
              <span className="text-sm font-semibold">
                {change > 0 ? '+' : ''}{change}%
              </span>
            </div>
            {changeLabel && (
              <span className="text-muted-foreground text-xs">{changeLabel}</span>
            )}
          </div>
        ) : changeLabel ? (
          <div className="flex items-center justify-end">
            <span className="text-muted-foreground text-xs">{changeLabel}</span>
          </div>
        ) : null}
      </div>

      {/* Decorative element */}
      <div className={`absolute -top-2 -right-2 w-16 h-16 ${colorClasses[color].bg} opacity-5 rounded-full transform rotate-12 group-hover:scale-110 transition-transform duration-300`} />
    </Card>
  );
} 