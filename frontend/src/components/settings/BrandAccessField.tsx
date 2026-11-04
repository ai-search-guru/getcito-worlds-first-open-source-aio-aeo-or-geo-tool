'use client';

import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import type { BrandAccessChoice, ShareableBrand } from '@/lib/actions/team';

/**
 * Which brands a person sees (BRAND-ACCESS §3.2), as the invite dialog and
 * Edit brands ask it: All brands, or Selected brands with a brand picker.
 * An admin always has All brands (D3): the choice shows, locked. The demo
 * brand isn't listed: everyone sees it.
 */
export function BrandAccessField({
  brands,
  value,
  onChange,
  adminRole = false,
  disabled = false,
}: {
  brands: ShareableBrand[];
  value: BrandAccessChoice;
  onChange: (value: BrandAccessChoice) => void;
  /** The role is Admin: All brands, locked. */
  adminRole?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations('settings.teamBrands');
  const scope = adminRole ? 'all' : value.scope;
  const chosen = new Set(value.brandIds);

  function toggle(brandId: string, on: boolean) {
    const next = on ? [...chosen, brandId] : [...chosen].filter((id) => id !== brandId);
    onChange({
      scope: 'selected',
      brandIds: brands.map((b) => b.id).filter((id) => next.includes(id)),
    });
  }

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{t('label')}</legend>
      <div role="radiogroup" aria-label={t('label')} className="grid grid-cols-2 gap-2">
        {(['all', 'selected'] as const).map((option) => {
          const locked = adminRole && option === 'selected';
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={scope === option}
              disabled={disabled || locked}
              onClick={() =>
                onChange({ scope: option, brandIds: option === 'all' ? [] : value.brandIds })
              }
              className={cn(
                'rounded-lg border bg-card px-3 py-2 text-left transition-colors',
                !locked && !disabled && 'hover:bg-accent/50',
                locked && 'cursor-not-allowed opacity-50',
                scope === option && 'border-foreground ring-1 ring-foreground',
              )}
            >
              <span className="block text-sm font-medium">{t(`${option}.title`)}</span>
              <span className="block text-xs text-muted-foreground">{t(`${option}.note`)}</span>
            </button>
          );
        })}
      </div>

      {adminRole && <p className="text-xs text-muted-foreground">{t('adminAlways')}</p>}

      {!adminRole && scope === 'selected' && (
        <div className="space-y-1.5">
          {brands.length === 0 ? (
            <p className="text-xs text-muted-foreground">{t('noBrands')}</p>
          ) : (
            <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded-lg border p-1.5">
              {brands.map((brand) => {
                const id = `brand-access-${brand.id}`;
                return (
                  <li key={brand.id}>
                    <Label
                      htmlFor={id}
                      className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm font-normal hover:bg-muted/60"
                    >
                      <Checkbox
                        id={id}
                        checked={chosen.has(brand.id)}
                        disabled={disabled}
                        onCheckedChange={(on) => toggle(brand.id, on === true)}
                      />
                      <span className="truncate">{brand.name}</span>
                    </Label>
                  </li>
                );
              })}
            </ul>
          )}
          <p
            className={cn(
              'text-xs',
              chosen.size === 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground',
            )}
          >
            {chosen.size === 0 ? t('pickOne') : t('chosen', { count: chosen.size })}
          </p>
        </div>
      )}
    </fieldset>
  );
}

/** "All brands", or "3 brands" for Selected brands. */
export function brandAccessLabel(
  t: ReturnType<typeof useTranslations<'settings.teamBrands'>>,
  value: BrandAccessChoice,
): string {
  return value.scope === 'all' ? t('all.title') : t('count', { count: value.brandIds.length });
}

/** A choice the server takes: Selected brands needs at least one brand. */
export function isBrandChoiceComplete(value: BrandAccessChoice, adminRole: boolean): boolean {
  return adminRole || value.scope === 'all' || value.brandIds.length > 0;
}
