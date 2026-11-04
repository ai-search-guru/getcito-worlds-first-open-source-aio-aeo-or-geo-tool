/**
 * Which landing pages can carry an AI-visibility opportunity at all (#705,
 * #719).
 *
 * Shared because both surfaces ask the same question and would otherwise
 * answer it differently: the suggestion generator needs "could a prompt lead
 * someone here", and the detection engine needs "is this page worth raising".
 * A page that fails one fails the other, and two copies of this list would
 * drift the first time either is extended.
 *
 * Two groups, excluded for different reasons:
 *
 *   Transactional — checkout, cart, confirmation, login, account. A GA4
 *   purchase event fires on the confirmation page, so without this the
 *   highest-revenue "page" in most shops is /checkout, and no prompt exists
 *   that a person would ask an assistant in order to arrive there.
 *
 *   Non-commercial — careers, legal, privacy. These take real traffic and
 *   real engagement, so they rank, but AI visibility on a job posting does
 *   not move the business the product is measuring. Leaving them in fills
 *   the list with findings nobody will act on.
 */

export const EXCLUDED_SEGMENTS = new Set([
  // Transactional
  'checkout',
  'cart',
  'basket',
  'order',
  'orders',
  'order-confirmation',
  'confirmation',
  'thank-you',
  'thanks',
  'payment',
  'pay',
  'login',
  'signin',
  'sign-in',
  'signup',
  'sign-up',
  'register',
  'logout',
  'account',
  'my-account',
  'profile',
  'dashboard',
  'admin',
  'wishlist',
  'favorites',
  'search',
  // Non-commercial
  'career',
  'careers',
  'jobs',
  'job',
  'cookie-policy',
  'privacy',
  'privacy-policy',
  'terms',
  'terms-of-service',
  'legal',
  'unsubscribe',
]);

/**
 * True for a page that cannot carry an opportunity.
 *
 * Matched on whole path segments, never as a substring: `/cart` is excluded
 * while `/cartography-guides` is kept, and `/careers` while
 * `/blog/career-advice-for-analysts` is kept. A substring check would delete
 * real content silently, which is the worst way to be wrong here.
 *
 * GA4's own placeholders count as excluded: a blank or "(not set)" landing
 * page is an unattributed session, not a page anyone can be sent to.
 */
export function isExcludedPath(path) {
  const raw = String(path ?? '').trim();
  if (!raw || raw === '(not set)' || raw === '(other)') return true;
  return raw
    .split(/[?#]/)[0]
    .split('/')
    .filter(Boolean)
    .some((segment) => EXCLUDED_SEGMENTS.has(segment.toLowerCase()));
}
