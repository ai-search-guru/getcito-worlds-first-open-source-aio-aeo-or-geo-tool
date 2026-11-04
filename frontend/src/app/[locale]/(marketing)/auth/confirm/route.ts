/**
 * GET /auth/confirm, as served: next-intl's middleware rewrites `/auth/*` to
 * `/[locale]/auth/*`, so this file answers the links in invite and password
 * reset e-mails. It runs the root route's code, so the two can't drift apart
 * (#1203): only a page on this site.
 */
export { GET } from '@/app/auth/confirm/route';
