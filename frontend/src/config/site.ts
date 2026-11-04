export const siteConfig = {
  name: 'GetCito',
  description:
    "Monitor, analyze, and optimize your brand's visibility in AI-powered search engines like ChatGPT, Perplexity, Gemini, and more.",
  url: 'https://getcito.com',
  ogImage: `${process.env.NEXT_PUBLIC_APP_URL || 'https://getcito.com'}/opengraph-image`,
  links: {
    github:
      'https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool',
    docs: 'https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/tree/main/docs',
    feedback: 'mailto:support@getcito.com',
  },
  legal: {
    privacy: 'https://getcito.com/privacy-policy',
    terms: 'https://getcito.com/terms-conditions',
  },
} as const;

export type SiteConfig = typeof siteConfig;
