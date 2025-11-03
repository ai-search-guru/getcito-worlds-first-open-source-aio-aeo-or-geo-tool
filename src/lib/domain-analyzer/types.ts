export interface AnalysisResult {
  strengths: string[];
  weaknesses: string[];
  improvements: string[];
  technicalStack: string[];
  competitorAnalysis: string[];
  marketPosition: string[];
  confidence: number;
  overallScore?: number;
} 