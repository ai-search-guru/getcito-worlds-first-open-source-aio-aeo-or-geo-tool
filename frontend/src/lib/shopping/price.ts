/**
 * Prices as Product Visibility shows them, in en-US like the rest of the UI.
 */

/** A price as the card shows it: "$139", "$24.50", "€89", or the amount and its code. */
export function priceText(value: number, currency: string | null): string {
  const digits = Number.isInteger(value) ? 0 : 2;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return `${value.toFixed(digits)} ${currency ?? ''}`.trim();
  }
}
