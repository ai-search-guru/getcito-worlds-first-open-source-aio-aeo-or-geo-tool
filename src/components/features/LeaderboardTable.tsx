'use client'
import React from 'react';
import { ChevronDown, ChevronUp, ExternalLink, Trophy, Medal, Award } from 'lucide-react';
import Card from '@/components/shared/Card';
import WebLogo from '@/components/shared/WebLogo';

interface LeaderboardEntry {
  rank: number;
  brand: string;
  domain?: string; // Added for WebLogo
  mentions: number;
  visibility: number;
  change: number;
  sentiment: 'positive' | 'negative' | 'neutral';
  logo?: string;
}

interface LeaderboardTableProps {
  title: string;
  data: LeaderboardEntry[];
  showSentiment?: boolean;
}

export default function LeaderboardTable({ 
  title, 
  data, 
  showSentiment = false 
}: LeaderboardTableProps): React.ReactElement {
  const getSentimentColor = (sentiment: string) => {
    switch (sentiment) {
      case 'positive':
        return 'text-[#00B087] bg-[#00B087]/10';
      case 'negative':
        return 'text-[#FF4D4D] bg-[#FF4D4D]/10';
      default:
        return 'text-muted-foreground bg-muted/50';
    }
  };

  const formatNumber = (num: number) => {
    if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
    if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
    return num.toString();
  };

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-5 w-5 text-[#FFD700]" />;
      case 2:
        return <Medal className="h-5 w-5 text-[#C0C0C0]" />;
      case 3:
        return <Award className="h-5 w-5 text-[#CD7F32]" />;
      default:
        return null;
    }
  };

  return (
    <Card variant="elevated" className="overflow-hidden">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <span className="text-muted-foreground text-sm bg-muted/50 px-2 py-1 rounded-full">
            {data.length} entries
          </span>
        </div>
        <button className="text-muted-foreground hover:text-foreground transition-colors p-2 hover:bg-accent rounded-lg">
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Rank</th>
              <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Brand</th>
              <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Mentions</th>
              <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Visibility</th>
              <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Change</th>
              {showSentiment && (
                <th className="text-left text-muted-foreground text-sm font-medium py-4 px-3">Sentiment</th>
              )}
            </tr>
          </thead>
          <tbody>
            {data.map((entry, index) => (
              <tr key={index} className="border-b border-border hover:bg-accent/50 transition-colors group">
                <td className="py-4 px-3">
                  <div className="flex items-center space-x-2">
                    {getRankIcon(entry.rank)}
                    <div className={`inline-flex items-center justify-center w-8 h-8 rounded-full text-sm font-bold transition-colors ${
                      entry.rank <= 3 
                        ? entry.rank === 1 
                          ? 'bg-gradient-to-br from-[#FFD700] to-[#FFA500] text-black' 
                          : entry.rank === 2 
                          ? 'bg-gradient-to-br from-[#C0C0C0] to-[#A8A8A8] text-black' 
                          : 'bg-gradient-to-br from-[#CD7F32] to-[#A0522D] text-white'
                        : 'bg-muted text-muted-foreground group-hover:bg-accent'
                    }`}>
                      {entry.rank}
                    </div>
                  </div>
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center space-x-3">
                    {entry.domain ? (
                      <WebLogo 
                        domain={entry.domain} 
                        size={32} 
                        className="shadow-sm"
                        alt={`${entry.brand} logo`}
                      />
                    ) : (
                      <div className="w-8 h-8 bg-muted rounded-xl flex items-center justify-center border border-border">
                        <span className="text-foreground text-sm font-semibold">
                          {entry.brand.charAt(0)}
                        </span>
                      </div>
                    )}
                    <div>
                      <span className="text-foreground font-medium">{entry.brand}</span>
                      <p className="text-muted-foreground text-xs">AI Platform</p>
                    </div>
                  </div>
                </td>
                <td className="py-4 px-3">
                  <div>
                    <span className="text-foreground font-medium">{formatNumber(entry.mentions)}</span>
                    <p className="text-muted-foreground text-xs">mentions</p>
                  </div>
                </td>
                <td className="py-4 px-3">
                  <div className="flex items-center space-x-3">
                    <div className="flex-1">
                      <div className="w-20 bg-muted rounded-full h-2 overflow-hidden">
                        <div 
                          className="bg-gradient-to-r from-[#000C60] to-[#000C60] h-2 rounded-full transition-all duration-300" 
                          style={{ width: `${entry.visibility}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-foreground text-sm font-medium min-w-[3rem]">{entry.visibility}%</span>
                  </div>
                </td>
                <td className="py-4 px-3">
                  <div className={`inline-flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium ${
                    entry.change > 0 
                      ? 'bg-[#00B087]/10 text-[#00B087]' 
                      : entry.change < 0 
                      ? 'bg-[#FF4D4D]/10 text-[#FF4D4D]' 
                      : 'bg-muted/50 text-muted-foreground'
                  }`}>
                    {entry.change > 0 && <ChevronUp className="h-3 w-3" />}
                    {entry.change < 0 && <ChevronDown className="h-3 w-3" />}
                    <span>
                      {entry.change > 0 ? '+' : ''}{entry.change}%
                    </span>
                  </div>
                </td>
                {showSentiment && (
                  <td className="py-4 px-3">
                    <span className={`inline-flex px-2 py-1 rounded-full text-xs font-medium capitalize ${getSentimentColor(entry.sentiment)}`}>
                      {entry.sentiment}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
} 