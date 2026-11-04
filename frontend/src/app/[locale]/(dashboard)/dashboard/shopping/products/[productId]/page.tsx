'use client';

import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { useFeatureGate } from '@/hooks/useFeatureGate';
import {
  getProductAiSays,
  getShoppingProductDetail,
  type ShoppingProductDetail,
} from '@/lib/actions/shopping';
import type { ProductAiSays } from '@/lib/shopping/aiSays';
import { useBrandStore } from '@/state/useBrandStore';
import { ProductDetailView } from '../../_ProductDetail';

/**
 * A product's page in Product Visibility (ECOM-011): where it stands on the
 * AI shelves of the questions it belongs on, and "Why not your product?":
 * it beside the product AI picked for the question it's missing most, row
 * by row, with its readiness and its AI visits and orders. What AI says
 * about it (ECOM-012) is read apart, its card filled when it comes: the
 * answers' text is the heavy part.
 */
export default function ShoppingProductPage() {
  const t = useTranslations('shopping.detail');
  const { productId } = useParams<{ productId: string }>();
  // Opened from the Shelf's "Why not you?": the shelf to explain first.
  const search = useSearchParams();
  const prompt = search.get('prompt');
  const platform = search.get('platform');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const { canUse } = useFeatureGate();
  // A plan without Product Visibility reads nothing: the page says it's locked.
  const allowed = canUse('shopping_analytics');
  const [read, setRead] = useState<{
    key: string;
    detail: ShoppingProductDetail | null | 'failed';
  } | null>(null);
  const key = `${activeBrandId}:${productId}:${prompt ?? ''}:${platform ?? ''}`;
  const [says, setSays] = useState<{ key: string; says: ProductAiSays | null } | null>(null);
  const saysKey = `${activeBrandId}:${productId}`;

  useEffect(() => {
    if (!allowed || !activeBrandId || !productId) return;
    let cancelled = false;
    getShoppingProductDetail(
      activeBrandId,
      productId,
      { datePreset: '30d' },
      prompt ? { promptId: prompt, platform } : null,
    )
      .then((detail) => {
        if (!cancelled) setRead({ key, detail });
      })
      .catch((err) => {
        console.error('Failed to read the product:', err);
        if (!cancelled) setRead({ key, detail: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, activeBrandId, productId, key, prompt, platform]);

  useEffect(() => {
    if (!allowed || !activeBrandId || !productId) return;
    let cancelled = false;
    getProductAiSays(activeBrandId, productId, { datePreset: '30d' })
      .then((read) => {
        if (!cancelled) setSays({ key: saysKey, says: read });
      })
      .catch((err) => {
        console.error('Failed to read what AI says about the product:', err);
        if (!cancelled) setSays({ key: saysKey, says: null });
      });
    return () => {
      cancelled = true;
    };
  }, [allowed, activeBrandId, productId, saysKey]);

  const back = (
    <Link
      href="/dashboard/shopping?tab=products"
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" aria-hidden />
      {t('back')}
    </Link>
  );
  const detail = read?.key === key ? read.detail : undefined;

  if (!allowed || detail === null || detail === 'failed') {
    return (
      <div className="space-y-6">
        {back}
        <p className="rounded-lg border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {!allowed ? t('locked') : detail === 'failed' ? t('failed') : t('notFound')}
        </p>
      </div>
    );
  }
  if (detail === undefined) {
    return (
      <div className="space-y-6">
        {back}
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-[320px] w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {back}
      <ProductDetailView
        detail={detail}
        brandId={activeBrandId ?? undefined}
        aiSays={says?.key === saysKey ? says.says : undefined}
      />
    </div>
  );
}
