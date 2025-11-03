'use client'
import React from 'react';
import { Citation } from '@/types/queryTypes';

// Types for competitor analysis
export interface CompetitorAnalysisResult {
  provider: 'chatgpt' | 'google' | 'perplexity';
  competitorMentioned: boolean;
  domainCited: boolean;
  citationCount: number;
  citations: Citation[];
  competitorMentionCount: number;
  domainCitationCount: number;
  competitorName: string;
}

export interface CompetitorMentionAnalysis {
  competitors: CompetitorAnalysisResult[];
  totals: {
    totalCompetitorMentions: number;
    totalCompetitorCitations: number;
    uniqueCompetitorsMentioned: number;
    providersWithCompetitorMention: number;
  };
}

export interface CompetitorData {
  name: string;
  domain?: string;
  aliases?: string[];
}

// Helper function to check if competitor is mentioned in text
export function isCompetitorMentioned(text: string, competitor: CompetitorData): boolean {
  if (!text || !competitor.name) return false;
  
  const lowerText = text.toLowerCase();
  const searchTerms = [
    competitor.name.toLowerCase(),
    ...(competitor.aliases || []).map(alias => alias.toLowerCase())
  ];
  
  // Check if competitor domain is mentioned (if provided)
  if (competitor.domain) {
    searchTerms.push(competitor.domain.toLowerCase());
  }
  
  return searchTerms.some(term => lowerText.includes(term));
}

// Helper function to check if competitor domain is cited
export function isCompetitorDomainCited(text: string, competitorDomain?: string): boolean {
  if (!text || !competitorDomain) return false;
  const lowerText = text.toLowerCase();
  const lowerDomain = competitorDomain.toLowerCase();
  return lowerText.includes(lowerDomain);
}

// Count competitor mentions in text
export function countCompetitorMentions(text: string, competitor: CompetitorData): number {
  if (!text || !competitor.name) return 0;
  
  const lowerText = text.toLowerCase();
  let count = 0;
  
  // Count mentions of competitor name
  const nameRegex = new RegExp(competitor.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
  const nameMatches = text.match(nameRegex);
  count += nameMatches ? nameMatches.length : 0;
  
  // Count mentions of aliases
  if (competitor.aliases) {
    competitor.aliases.forEach(alias => {
      const aliasRegex = new RegExp(alias.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      const aliasMatches = text.match(aliasRegex);
      count += aliasMatches ? aliasMatches.length : 0;
    });
  }
  
  return count;
}

// Count competitor domain citations
export function countCompetitorDomainCitations(citations: Citation[], competitorDomain?: string): number {
  if (!citations || !competitorDomain) return 0;
  
  const lowerDomain = competitorDomain.toLowerCase();
  return citations.filter(citation => 
    citation.url.toLowerCase().includes(lowerDomain)
  ).length;
}

// Main function to analyze competitor mentions across all providers
export function analyzeCompetitorMentions(
  competitors: CompetitorData[],
  queryResults: {
    chatgpt?: { response: string; citations?: Citation[] };
    googleAI?: { aiOverview: string; citations?: Citation[] };
    perplexity?: { response: string; citations?: Citation[] };
  }
): CompetitorMentionAnalysis {
  const allCompetitorResults: CompetitorAnalysisResult[] = [];
  
  competitors.forEach(competitor => {
    // Analyze ChatGPT results
    if (queryResults.chatgpt) {
      const chatgptResult: CompetitorAnalysisResult = {
        provider: 'chatgpt',
        competitorName: competitor.name,
        competitorMentioned: isCompetitorMentioned(queryResults.chatgpt.response, competitor),
        domainCited: isCompetitorDomainCited(queryResults.chatgpt.response, competitor.domain),
        citations: queryResults.chatgpt.citations || [],
        citationCount: (queryResults.chatgpt.citations || []).length,
        competitorMentionCount: countCompetitorMentions(queryResults.chatgpt.response, competitor),
        domainCitationCount: countCompetitorDomainCitations(queryResults.chatgpt.citations || [], competitor.domain)
      };
      allCompetitorResults.push(chatgptResult);
    }
    
    // Analyze Google AI results
    if (queryResults.googleAI) {
      const googleResult: CompetitorAnalysisResult = {
        provider: 'google',
        competitorName: competitor.name,
        competitorMentioned: isCompetitorMentioned(queryResults.googleAI.aiOverview, competitor),
        domainCited: isCompetitorDomainCited(queryResults.googleAI.aiOverview, competitor.domain),
        citations: queryResults.googleAI.citations || [],
        citationCount: (queryResults.googleAI.citations || []).length,
        competitorMentionCount: countCompetitorMentions(queryResults.googleAI.aiOverview, competitor),
        domainCitationCount: countCompetitorDomainCitations(queryResults.googleAI.citations || [], competitor.domain)
      };
      allCompetitorResults.push(googleResult);
    }
    
    // Analyze Perplexity results
    if (queryResults.perplexity) {
      const perplexityResult: CompetitorAnalysisResult = {
        provider: 'perplexity',
        competitorName: competitor.name,
        competitorMentioned: isCompetitorMentioned(queryResults.perplexity.response, competitor),
        domainCited: isCompetitorDomainCited(queryResults.perplexity.response, competitor.domain),
        citations: queryResults.perplexity.citations || [],
        citationCount: (queryResults.perplexity.citations || []).length,
        competitorMentionCount: countCompetitorMentions(queryResults.perplexity.response, competitor),
        domainCitationCount: countCompetitorDomainCitations(queryResults.perplexity.citations || [], competitor.domain)
      };
      allCompetitorResults.push(perplexityResult);
    }
  });
  
  // Calculate totals
  const totalCompetitorMentions = allCompetitorResults.reduce(
    (sum, result) => sum + result.competitorMentionCount, 0
  );
  
  const totalCompetitorCitations = allCompetitorResults.reduce(
    (sum, result) => sum + result.domainCitationCount, 0
  );
  
  const uniqueCompetitorsMentioned = new Set(
    allCompetitorResults
      .filter(result => result.competitorMentioned)
      .map(result => result.competitorName)
  ).size;
  
  const providersWithCompetitorMention = new Set(
    allCompetitorResults
      .filter(result => result.competitorMentioned)
      .map(result => result.provider)
  ).size;
  
  return {
    competitors: allCompetitorResults,
    totals: {
      totalCompetitorMentions,
      totalCompetitorCitations,
      uniqueCompetitorsMentioned,
      providersWithCompetitorMention
    }
  };
}

// Helper function to generate competitor domain from name
export function generateCompetitorDomain(competitorName: string): string {
  return `${competitorName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}.com`;
}

// Helper function to prepare competitors data with domains
export function prepareCompetitorsData(competitorNames: string[]): CompetitorData[] {
  return competitorNames.map(name => ({
    name,
    domain: generateCompetitorDomain(name),
    aliases: [
      name.toLowerCase(),
      name.toUpperCase(),
      name.split(' ')[0], // First word as alias
    ]
  }));
}

export default function CompetitorMatchingCounter(): React.ReactElement {
  // This component provides the logic but doesn't render anything
  // It's used as a utility component similar to BrandMentionCounter
  return <></>;
}