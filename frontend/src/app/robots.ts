import type { MetadataRoute } from 'next';

/**
 * Block search engines from indexing the application subdomain.
 *
 * The public site at `getcito.com` is the surface that should be indexed.
 * This Next.js app is the authenticated product UI.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        disallow: '/',
      },
    ],
  };
}
