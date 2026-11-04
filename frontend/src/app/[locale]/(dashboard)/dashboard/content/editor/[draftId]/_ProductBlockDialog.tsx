'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  getProductsForBlock,
  searchProductsForBlock,
  type BlockProductRead,
} from '@/lib/actions/shoppingPath';
import { MAX_BLOCK_PRODUCTS, productBlockHtml, productHref } from '@/lib/content/productBlock';
import { priceText } from './_ShoppingPath';

/**
 * + Insert › Products (shopping path, part 5): the person searches the
 * brand's catalog by name and picks one to four products in stock with a
 * page; Insert puts them on the line as an HTML block, a card for one, a
 * grid for more, each with its picture, name and price, linked to its page.
 * Read again on Insert: one sold out since is left out, and said so.
 */
export function ProductBlockDialog({
  brandId,
  onInsert,
  onClose,
}: {
  brandId: string;
  onInsert: (code: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.productBlock');
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<BlockProductRead[] | 'failed' | null>(null);
  const [picked, setPicked] = useState<BlockProductRead[]>([]);
  const [busy, setBusy] = useState(false);

  // Closed (Cancel, Esc) while the products are read: nothing goes in the page.
  const closed = useRef(false);
  useEffect(() => {
    closed.current = false;
    return () => {
      closed.current = true;
    };
  }, []);
  const close = () => {
    closed.current = true;
    onClose();
  };

  useEffect(() => {
    if (query.trim().length < 2) {
      setHits(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      searchProductsForBlock(brandId, query).then(
        (found) => {
          if (!cancelled) setHits(found);
        },
        (err) => {
          console.error('Failed to search the catalog:', err);
          if (!cancelled) setHits('failed');
        },
      );
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, brandId]);

  const isPicked = (id: string) => picked.some((p) => p.id === id);
  /** Why a product can't go in a block, or null: not in stock, or no page to link. */
  const blocked = (p: BlockProductRead) =>
    !p.inStock ? t('notInStock') : !productHref(p.url) ? t('noPage') : null;
  const toggle = (hit: BlockProductRead) =>
    setPicked((now) =>
      now.some((p) => p.id === hit.id)
        ? now.filter((p) => p.id !== hit.id)
        : now.length < MAX_BLOCK_PRODUCTS
          ? [...now, hit]
          : now,
    );

  const insert = async () => {
    setBusy(true);
    try {
      const read = await getProductsForBlock(
        brandId,
        picked.map((p) => p.id),
      );
      if (closed.current) return;
      const now = new Map(read.map((p) => [p.id, p]));
      // Sold out since it was picked, or gone from the catalog: left out, and said so.
      const left = picked.filter((p) => !now.get(p.id)?.inStock);
      if (left.length) {
        toast.warning(t('leftOut', { titles: left.map((p) => p.title).join(', ') }));
      }
      const code = productBlockHtml(
        picked.flatMap((p) => {
          const product = now.get(p.id);
          return product?.inStock
            ? [
                {
                  title: product.title,
                  url: product.url,
                  image: product.image,
                  price: priceText(product),
                },
              ]
            : [];
        }),
      );
      if (!code) {
        if (!left.length) toast.error(t('noLink'));
        // Nothing to put in: the ones left out are unpicked, for others to be picked.
        setPicked((was) => was.filter((p) => now.get(p.id)?.inStock));
        return;
      }
      onInsert(code);
      close();
    } catch (err) {
      if (closed.current) return;
      console.error('Failed to read the products:', err);
      toast.error(t('failed'));
    } finally {
      if (!closed.current) setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && close()}>
      <DialogContent className="sm:max-w-lg" initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description', { max: MAX_BLOCK_PRODUCTS })}</DialogDescription>
        </DialogHeader>
        <Input
          ref={inputRef}
          type="search"
          value={query}
          maxLength={100}
          placeholder={t('placeholder')}
          aria-label={t('searchLabel')}
          onChange={(e) => setQuery(e.target.value)}
        />
        {hits === 'failed' && (
          <p className="text-xs text-muted-foreground" role="alert">
            {t('searchFailed')}
          </p>
        )}
        {Array.isArray(hits) && hits.length === 0 && (
          <p className="text-xs text-muted-foreground">{t('empty')}</p>
        )}
        {Array.isArray(hits) && hits.length > 0 && (
          <ul className="max-h-64 divide-y overflow-y-auto rounded-md border">
            {hits.map((hit) => {
              const on = isPicked(hit.id);
              const why = blocked(hit);
              return (
                <li key={hit.id}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={!on && (!!why || picked.length >= MAX_BLOCK_PRODUCTS)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                    onClick={() => toggle(hit)}
                  >
                    <span
                      aria-hidden="true"
                      className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {why ?? priceText(hit)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {t('picked', { count: picked.length, max: MAX_BLOCK_PRODUCTS })}
          </p>
          {picked.length > 0 && (
            <ul className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <li
                  key={p.id}
                  className="flex max-w-full items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs"
                >
                  <span className="truncate">{p.title}</span>
                  <button
                    type="button"
                    aria-label={t('unpick', { title: p.title })}
                    className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => toggle(p)}
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button disabled={!picked.length || busy} aria-busy={busy} onClick={() => void insert()}>
            {busy ? t('inserting') : t('insert')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
