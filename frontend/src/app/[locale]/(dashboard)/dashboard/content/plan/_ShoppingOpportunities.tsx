'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { buttonVariants } from '@/components/ui/button-variants';
import { Card, CardContent } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PriorityBadge } from '@/components/action-center/ActionTable';
import { DRAFT_METHOD_BADGE } from '@/components/content/DraftBadges';
import { createContentDraft } from '@/lib/actions/contentDrafts';
import { getShoppingPlan } from '@/lib/actions/shoppingPlan';
import { listCategoryPages } from '@/lib/catalogClient';
import { contentEditorPath } from '@/lib/content/drafts';
import { planPriorityLevel } from '@/lib/content/plan';
import { categoryLeaf, shoppingOpportunities, type ShoppingRow } from '@/lib/content/shoppingPlan';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';

type Read = {
  brandId: string;
  rows: ShoppingRow[];
  products: number;
  categories: number;
};

/**
 * Plan › Shopping opportunities (shopping path, part 7): for a shop whose
 * catalog has categories, the buying guides its categories in stock are
 * missing and the published posts whose shopping links need fixing
 * (lib/content/shoppingPlan.ts), ranked on the Plan's scale. Create starts
 * the guide as a draft in the editor; a row with a draft opens it. Read on
 * its own: when it can't be, or the catalog has no categories, the section
 * stays hidden and the Plan works as before. `hidden` keeps what it read
 * while the Plan's list loads another period.
 */
export function ShoppingOpportunities({
  brandId,
  hidden = false,
}: {
  brandId: string;
  hidden?: boolean;
}) {
  const t = useTranslations('contentEditor.plan.shopping');
  const router = useRouter();
  const [read, setRead] = useState<Read | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([listCategoryPages(brandId), getShoppingPlan(brandId)])
      .then(([categories, plan]) => {
        if (cancelled) return;
        if (!categories.ok) {
          console.error('Failed to read the catalog categories:', categories.code);
          return;
        }
        setRead({
          brandId,
          rows: shoppingOpportunities({ categories: categories.value, ...plan }),
          products: plan.products,
          categories: categories.value.length,
        });
      })
      .catch((err) => console.error('Failed to read the shopping opportunities:', err));
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  const current = read?.brandId === brandId ? read : null;
  if (hidden || !current || current.categories === 0) return null;

  const create = async (row: Extract<ShoppingRow, { kind: 'guide' }>) => {
    setCreating(row.key);
    try {
      const id = await createContentDraft(brandId, {
        method: 'create',
        title: t('guideTitle', { category: row.leaf.toLocaleLowerCase() }),
        pageType: 'buying_guide',
        typePicked: true,
        // The first prompt asking about it, else none yet: added in Sources.
        source: row.promptId ? { kind: 'prompt', id: row.promptId } : { kind: 'content' },
      });
      router.push(contentEditorPath(id));
    } catch (err) {
      console.error('Failed to start the buying guide:', err);
      toast.error(t('createFailed'));
      setCreating(null);
    }
  };

  return (
    <ShoppingOpportunitiesView
      rows={current.rows}
      products={current.products}
      categories={current.categories}
      creating={creating}
      onCreate={(row) => void create(row)}
    />
  );
}

/** The section as read: the catalog's line, the rows, and each row's button. */
export function ShoppingOpportunitiesView({
  rows,
  products,
  categories,
  creating,
  onCreate,
}: {
  rows: ShoppingRow[];
  products: number;
  categories: number;
  /** The guide being started, by its row's key: every Create waits for it. */
  creating: string | null;
  onCreate: (row: Extract<ShoppingRow, { kind: 'guide' }>) => void;
}) {
  const t = useTranslations('contentEditor.plan.shopping');
  return (
    <section aria-labelledby="shopping-opportunities" className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 id="shopping-opportunities" className="text-sm font-medium">
            {t('title')}
          </h2>
          <p className="text-xs text-muted-foreground">{t('lead')}</p>
        </div>
        <p className="text-xs text-muted-foreground">{t('catalog', { products, categories })}</p>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <p className="px-6 py-8 text-center text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">{t('columns.page')}</TableHead>
                  <TableHead>{t('columns.why')}</TableHead>
                  <TableHead>{t('columns.category')}</TableHead>
                  <TableHead>{t('columns.score')}</TableHead>
                  <TableHead className="pr-6 text-right">{t('columns.action')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell className="min-w-[160px] max-w-[200px] whitespace-normal pl-6 xl:max-w-[260px]">
                      <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {t(`kinds.${row.kind}`)}
                        <Badge
                          variant="outline"
                          className={cn(
                            'shrink-0',
                            row.kind === 'fix'
                              ? DRAFT_METHOD_BADGE.optimize
                              : row.draft
                                ? 'font-normal'
                                : DRAFT_METHOD_BADGE.create,
                          )}
                        >
                          {t(`badges.${row.kind === 'fix' ? 'fix' : row.draft ? 'draft' : 'new'}`)}
                        </Badge>
                      </p>
                      <RowTitle row={row} title={t('guideTitle', { category: guideName(row) })} />
                    </TableCell>
                    <TableCell className="min-w-[220px] max-w-[360px] whitespace-normal text-sm text-muted-foreground">
                      <WhyText row={row} />
                    </TableCell>
                    <TableCell className="max-w-[160px] xl:max-w-[200px]">
                      <CategoryCell row={row} />
                    </TableCell>
                    <TableCell>
                      <PriorityBadge
                        score={Math.round(row.score)}
                        level={planPriorityLevel(row.score)}
                        levelClassName="hidden xl:inline"
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      {row.draft ? (
                        <Link
                          href={contentEditorPath(row.draft.id)}
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                        >
                          {row.kind === 'fix' ? t('optimize') : t('open')}
                        </Link>
                      ) : row.kind === 'guide' ? (
                        <Button
                          size="sm"
                          disabled={creating !== null}
                          onClick={() => onCreate(row)}
                          className="gap-1.5"
                        >
                          {creating === row.key && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          {t('create')}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
    </section>
  );
}

/** A guide's category as its title reads it: "How to choose hiking boots". */
function guideName(row: ShoppingRow): string {
  return row.kind === 'guide' ? row.leaf.toLocaleLowerCase() : '';
}

function RowTitle({ row, title }: { row: ShoppingRow; title: string }) {
  const text = row.kind === 'fix' ? row.draft.title : (row.draft?.title ?? title);
  return (
    <p className="mt-0.5 line-clamp-2 break-words font-medium" title={text}>
      {text}
    </p>
  );
}

/** Why the row is listed, in one or two sentences. */
function WhyText({ row }: { row: ShoppingRow }) {
  const t = useTranslations('contentEditor.plan.shopping.why');
  if (row.kind === 'guide') {
    const category = row.leaf.toLocaleLowerCase();
    return (
      <>
        {row.draft
          ? t('draft')
          : row.prompts > 0
            ? t('prompts', { category, count: row.prompts })
            : t('noPrompts', { category })}
        {!row.category.page && <> {t('noCategoryPage')}</>}
      </>
    );
  }
  const lines: string[] = [];
  if (row.categoriesLinked < row.categories) {
    lines.push(
      row.categories === 1 && row.categoryName
        ? t('noCategoryLink', { category: categoryLeaf(row.categoryName) })
        : t('categoryLinks', { linked: row.categoriesLinked, count: row.categories }),
    );
  }
  if (row.bad > 0) lines.push(t(row.soldOut ? 'soldOut' : 'noLongerSell', { count: row.bad }));
  return <>{lines.join(' ')}</>;
}

/** The category's own name and its products, as the catalog counts them now. */
function CategoryCell({ row }: { row: ShoppingRow }) {
  const t = useTranslations('contentEditor.plan.shopping');
  const category = row.category;
  const name = row.kind === 'guide' ? row.leaf : row.categoryName;
  if (!name) return <span className="text-muted-foreground">—</span>;
  return (
    <>
      <p className="truncate text-sm" title={category?.name ?? name}>
        {categoryLeaf(name)}
      </p>
      <p className="truncate text-xs text-muted-foreground">
        {category
          ? t('stock', { products: category.products, inStock: formatNumber(category.inStock) })
          : t('categoryGone')}
      </p>
    </>
  );
}
