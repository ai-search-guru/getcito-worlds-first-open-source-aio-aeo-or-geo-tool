/**
 * GET /auth/callback, as served: next-intl's middleware rewrites `/auth/*` to
 * `/[locale]/auth/*`, so this file answers the URL the OAuth providers come
 * back to. It runs the root route's code, so the two can't drift apart
 * (#1203): only a page on this site, and the OAuth buttons' `next` cookie.
 */
export { GET } from '@/app/auth/callback/route';
