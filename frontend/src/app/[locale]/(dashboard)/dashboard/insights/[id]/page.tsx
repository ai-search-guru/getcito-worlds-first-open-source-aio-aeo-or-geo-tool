'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { getPromptResultById, type PromptResultWithText } from '@/lib/actions/tracking';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  AlertCircle,
  ArrowLeft,
  ExternalLink,
  MessageSquareText,
  Quote,
  Eye,
  Clock,
  RotateCw,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PLATFORM_LABELS } from '@/config/platformLabels';
import { ResponseDetail } from '@/components/results/ResponseDetail';
import { formatRegionDisplay } from '@/lib/region';
import { formatDateTime } from '@/lib/format';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

function SentimentBadge({ sentiment }: { sentiment: 'positive' | 'neutral' | 'negative' }) {
  const t = useTranslations('insights');
  return (
    <Badge
      variant="outline"
      className={cn(
        'text-xs',
        sentiment === 'positive' &&
          'border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-400',
        sentiment === 'neutral' &&
          'border-yellow-500/30 bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
        sentiment === 'negative' &&
          'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
      )}
    >
      {t(sentiment)}
    </Badge>
  );
}

export default function ResultDetailPage() {
  const params = useParams();
  const router = useRouter();
  const resultId = params.id as string;
  const t = useTranslations('insights');
  const tDetail = useTranslations('insights.resultDetail');
  const common = useTranslations('common');

  const [result, setResult] = useState<PromptResultWithText | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadFailed(false);
      try {
        const data = await getPromptResultById(resultId);
        if (cancelled) return;
        if (!data) {
          setNotFound(true);
        } else {
          setResult(data);
        }
      } catch {
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [resultId, attempt]);

  // Opened in its own tab ("Open full page" on a prompt) there is no history
  // to go back to, so Back leads to the result's prompt instead.
  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push(result ? `/dashboard/prompts/${result.promptId}` : '/dashboard/prompts');
  };

  if (loading) {
    return (
      <div className="space-y-6 p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-96" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="h-12 w-12 text-destructive/60 mb-4" />
        <h2 className="text-lg font-semibold">{tDetail('loadFailedTitle')}</h2>
        <p className="text-muted-foreground text-sm mt-1">{tDetail('loadFailedDescription')}</p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" className="gap-2" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
            {tDetail('goBack')}
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => setAttempt((n) => n + 1)}>
            <RotateCw className="h-4 w-4" />
            {common('retry')}
          </Button>
        </div>
      </div>
    );
  }

  if (notFound || !result) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageSquareText className="h-12 w-12 text-muted-foreground/40 mb-4" />
        <h2 className="text-lg font-semibold">{tDetail('notFoundTitle')}</h2>
        <p className="text-muted-foreground text-sm mt-1">{tDetail('notFoundDescription')}</p>
        <Button variant="outline" className="mt-6 gap-2" onClick={goBack}>
          <ArrowLeft className="h-4 w-4" />
          {tDetail('goBack')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-2 sm:p-6 max-w-5xl mx-auto">
      <HeaderWithAiUsage>
        <div className="space-y-6">
          {/* Back button */}
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 -ml-2 text-muted-foreground hover:text-foreground"
            onClick={goBack}
          >
            <ArrowLeft className="h-4 w-4" />
            {common('back')}
          </Button>

          {/* Header */}
          <div className="space-y-3">
            <h1 className="text-xl font-semibold leading-snug">{result.promptText}</h1>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {PLATFORM_LABELS[result.platform] ?? result.platform}
              </Badge>
              <SentimentBadge sentiment={result.sentiment} />
              <Badge variant="outline" className="text-xs gap-1">
                <Eye className="h-3 w-3" />
                {result.visibilityScore}/100
              </Badge>
              {result.region && (
                <Badge variant="outline" className="text-xs">
                  {formatRegionDisplay(result.region)}
                </Badge>
              )}
            </div>
          </div>
        </div>
      </HeaderWithAiUsage>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <MessageSquareText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.mentionCount}</p>
              <p className="text-xs text-muted-foreground">{t('mentions')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <Quote className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.citationCount}</p>
              <p className="text-xs text-muted-foreground">{tDetail('brandCitations')}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 p-4">
            <ExternalLink className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-2xl font-bold tabular-nums">{result.citations.length}</p>
              <p className="text-xs text-muted-foreground">{tDetail('totalCitations')}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <ResponseDetail result={result} variant="page" />

      {/* Timestamp */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground pb-6">
        <Clock className="h-3.5 w-3.5" />
        {tDetail('checkedAt', { date: formatDateTime(result.createdAt) })}
      </div>
    </div>
  );
}
