import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';

const inter = localFont({
  src: [
    { path: '../../public/fonts/Inter-Regular.ttf', weight: '400', style: 'normal' },
    { path: '../../public/fonts/Inter-Bold.ttf', weight: '700', style: 'normal' },
  ],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'https://getcito.com'),
  title: {
    default: 'GetCito',
    template: '%s | GetCito',
  },
  description:
    "Monitor, analyze, and optimize your brand's visibility in AI-powered search engines.",
  openGraph: {
    title: 'GetCito',
    description:
      'Track how AI search engines mention your brand — ChatGPT, Gemini, Perplexity, Claude, Copilot.',
    url: '/',
    siteName: 'GetCito',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'GetCito',
    description:
      'Track how AI search engines mention your brand — ChatGPT, Gemini, Perplexity, Claude, Copilot.',
  },
  // Product app pages stay out of search results; the public GetCito site
  // is the indexable surface.
  robots: {
    index: false,
    follow: false,
    googleBot: {
      index: false,
      follow: false,
    },
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html suppressHydrationWarning className={inter.variable}>
      <body suppressHydrationWarning className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
