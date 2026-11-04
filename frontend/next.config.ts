import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

process.env.NEXT_TELEMETRY_DISABLED = '1';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

const nextConfig: NextConfig = {
  output: 'standalone',
  // Chat's PDF downloads (CHAT-06 item 32) render on the server with
  // @react-pdf/renderer, which reads Inter from public/fonts at run time:
  // the package stays outside the server bundle, and the fonts go with the
  // routes that write a PDF (Vercel serves public/ from its CDN only).
  serverExternalPackages: ['@react-pdf/renderer'],
  outputFileTracingIncludes: {
    '/api/chat/runs/[id]/export': ['./public/fonts/**/*'],
    '/api/chat/conversations/[id]/export': ['./public/fonts/**/*'],
    '/api/chat/runs/[id]/files/[n]': ['./public/fonts/**/*'],
    '/api/chat/files/[id]': ['./public/fonts/**/*'],
    '/api/chat/files/zip': ['./public/fonts/**/*'],
  },
  // The Prompts area has a route per view (PROMPT-001). Older links and
  // bookmarks — /dashboard/prompts and its ?tab= / ?view= shapes — land on
  // the matching route; their other query params come along.
  async redirects() {
    const base = '/dashboard/prompts';
    return [
      {
        source: base,
        has: [{ type: 'query', key: 'tab', value: 'fanout' }],
        destination: `${base}/fan-outs`,
        permanent: false,
      },
      {
        source: base,
        has: [{ type: 'query', key: 'tab', value: 'insights' }],
        destination: `${base}/insights`,
        permanent: false,
      },
      {
        source: base,
        has: [{ type: 'query', key: 'view', value: 'suggestions' }],
        destination: `${base}/suggestions`,
        permanent: false,
      },
      { source: base, destination: `${base}/tracked`, permanent: false },
    ];
  },
};

export default withNextIntl(nextConfig);
