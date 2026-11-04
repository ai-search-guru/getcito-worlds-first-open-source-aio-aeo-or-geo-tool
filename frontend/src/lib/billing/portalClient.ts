/**
 * Opens Stripe's billing page for the organization (POST /api/stripe/portal),
 * where the card is updated: Billing's Manage billing, and the read-only
 * notices for a payment that didn't go through. Navigates away on success;
 * throws with the route's error otherwise.
 */
export async function openBillingPortal(): Promise<void> {
  const res = await fetch('/api/stripe/portal', { method: 'POST' });
  const body = (await res.json().catch(() => ({}))) as { url?: string; error?: string };
  if (!res.ok || !body.url) throw new Error(body.error || 'Failed to open billing portal');
  window.location.href = body.url;
}
