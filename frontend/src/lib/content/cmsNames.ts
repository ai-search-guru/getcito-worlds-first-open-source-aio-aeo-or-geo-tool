import type { CmsTarget } from '@/lib/content/cmsSendClient';

/** A CMS a page goes to, as the app names it (the Send dialog, Chat's cards and Activity). */
export const CMS_NAMES: Record<CmsTarget, string> = {
  webflow: 'Webflow',
  wordpress: 'WordPress',
  framer: 'Framer',
  wix: 'Wix',
  webhook: 'Webhook',
};

/**
 * The CMSs Chat sends a page to, as a draft there (push_cms_draft). Never the
 * brand's webhook: it hands the page to the brand's own automation, which
 * may publish it, so it goes out of GetCito (an EXECUTE, CHAT-20 §3) and
 * only the editor's Send does it.
 */
export const CHAT_CMS_TARGETS = ['webflow', 'wordpress', 'framer', 'wix'] as const;
export type ChatCmsTarget = (typeof CHAT_CMS_TARGETS)[number];
