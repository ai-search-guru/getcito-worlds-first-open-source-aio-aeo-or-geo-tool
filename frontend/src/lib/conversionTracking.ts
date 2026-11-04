/**
 * What a brand installs to see conversions from AI visits (CE-017): the
 * tracking snippet's tag, with conversions on (data-c, data-consent), the
 * lines the site adds, and the Shopify Customer events pixel. Built here, as
 * the snippet's tag always was, from the public API URL and the brand's
 * tracking code; the snippet itself is the server's (trackingScript.js).
 */

export type ConversionsConsent = 'wait' | 'always';

export const CONSENT_MODES: readonly ConversionsConsent[] = ['wait', 'always'];

export function isConversionsConsent(value: unknown): value is ConversionsConsent {
  return value === 'wait' || value === 'always';
}

/**
 * Lets the page call getcito() before t.js has run: the tag is deferred, so
 * a banner's or a thank-you page's call always comes first, and t.js runs
 * what it queued.
 */
export const QUEUE_STUB =
  '<script>window.getcito=window.getcito||function(){(getcito.q=getcito.q||[]).push(arguments)};</script>';

/**
 * The snippet's tag for a brand, or null without an API URL or a tracking
 * code. With conversions (the brand's consent mode), it follows AI visitors
 * to conversions, the queue stub on the line above it; without, it is the
 * tag as it always was.
 */
export function trackingSnippetTag(
  apiUrl: string | null | undefined,
  trackingCode: string | null | undefined,
  conversions: ConversionsConsent | null = null,
): string | null {
  if (!apiUrl || !trackingCode) return null;
  if (!conversions) return `<script src="${apiUrl}/t.js" data-t="${trackingCode}" defer></script>`;
  return `${QUEUE_STUB}\n<script src="${apiUrl}/t.js" data-t="${trackingCode}" data-c="1" data-consent="${conversions}" defer></script>`;
}

/** What the site calls once the visitor agrees (its cookie banner), on every page. */
export const CONSENT_CALL = "getcito('consent', 'granted');";

/**
 * What the site calls when the visitor says no or takes consent back: the
 * snippet takes an id kept earlier as consent given, so without it a
 * visitor who changes their mind is still followed.
 */
export const DENY_CALL = "getcito('consent', 'denied');";

/**
 * Shopify's own cookie banner, told to the snippet (Customer Privacy API):
 * the answer when the visitor gives it, and on each page the one given
 * before (or that none is needed where they are).
 */
export const SHOPIFY_CONSENT_BRIDGE = `<script>
document.addEventListener('visitorConsentCollected', function (e) {
  getcito('consent', e.detail.analyticsAllowed ? 'granted' : 'denied');
});
window.Shopify && Shopify.loadFeatures && Shopify.loadFeatures(
  [{ name: 'consent-tracking-api', version: '0.1' }],
  function (error) {
    if (!error && Shopify.customerPrivacy.analyticsProcessingAllowed()) getcito('consent', 'granted');
  }
);
</script>`;

/** The site's own conversion, and an order with its value and units. */
export const CONVERSION_CALL = "getcito('conversion', { type: 'demo' });";
export const ORDER_CALL =
  "getcito('conversion', { type: 'order', value: 129.5, currency: 'EUR', units: 2, order: '1001' });";

/** What a form adds to say its goal, or to stay out. */
export const FORM_GOAL_ATTRIBUTE = 'data-getcito-goal="demo"';
export const FORM_OFF_ATTRIBUTE = 'data-getcito="off"';

/**
 * The Shopify Customer events custom pixel (Web Pixels API): Shopify runs no
 * theme code on checkout, so the order is sent from here, with its value,
 * currency and units, by the visitor id the snippet kept on the storefront
 * (the checkout is on the shop's domain; a headless store's checkout on
 * another domain can't read it). A visitor the snippet didn't follow (no AI
 * visit, no consent) sends nothing; the server credits the rest as the
 * snippet's events, and counts an order sent twice once, by its id; one
 * Shopify gives no id for goes without, as the checkout's token isn't an
 * order's id (it's in the thank-you page's path). Only an amount and
 * units the server takes go. The checkout's address goes as /checkout: its
 * path carries the order's token. Null without an API URL or a tracking
 * code.
 */
export function shopifyPixelCode(
  apiUrl: string | null | undefined,
  trackingCode: string | null | undefined,
): string | null {
  if (!apiUrl || !trackingCode) return null;
  return `// GetCito: orders from AI visits
const GETCITO_TRACK = ${JSON.stringify(`${apiUrl}/track/${trackingCode}`)};
analytics.subscribe("checkout_completed", async (event) => {
  let visitor = null;
  try {
    visitor = JSON.parse((await browser.localStorage.getItem("getcito_v")) || "null");
  } catch (e) {}
  if (!visitor || !visitor.id || !visitor.f) return;
  const checkout = event.data.checkout || {};
  const total = checkout.totalPrice || {};
  const units = (checkout.lineItems || []).reduce((sum, item) => sum + (item.quantity || 0), 0);
  const order = {
    k: "cv",
    g: "order",
    o: "shopify",
    id: visitor.id,
    f: visitor.f,
    u: event.context.document.location.origin + "/checkout",
  };
  if (Number.isInteger(units) && units >= 0 && units <= 100000) order.q = units;
  const value = Number(total.amount);
  if (Number.isFinite(value) && value >= 0 && value <= 1e9) order.val = value;
  if (typeof total.currencyCode === "string") order.cur = total.currencyCode;
  const ref = checkout.order && checkout.order.id;
  if (ref) order.ref = String(ref);
  fetch(GETCITO_TRACK, {
    method: "POST",
    body: JSON.stringify(order),
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    keepalive: true,
  }).catch(() => {});
});
`;
}
