import { z } from 'zod';

/**
 * The brand as setup's suggestion routes put it into a model's prompt
 * (/topics/suggest, /prompts/from-topics, /competitors/suggest, and the
 * Topics page's refresh). Bounded, so one call costs what a setup's own
 * does, whatever is sent: the JSON body limit alone would let a call carry
 * megabytes into a prompt, up to three attempts each. The web cuts what it
 * sends to the same lengths (frontend/src/lib/aiBrandSetup.ts), so a real
 * setup never meets them.
 */
export const BRAND_SETUP_LIMITS = {
  name: 200,
  website: 200,
  industry: 200,
  description: 2000,
  topics: 20,
  topic: 100,
};

const text = (max) => z.string().max(max).nullish();

/** The body of /topics/suggest and /competitors/suggest. */
export const brandSetupSchema = z.object({
  brandName: z.string().trim().min(1).max(BRAND_SETUP_LIMITS.name),
  industry: text(BRAND_SETUP_LIMITS.industry),
  description: text(BRAND_SETUP_LIMITS.description),
  website: text(BRAND_SETUP_LIMITS.website),
  language: text(20),
  region: text(20),
});

/** The body of /prompts/from-topics: the brand and the topics chosen. */
export const promptsFromTopicsSchema = brandSetupSchema.extend({
  topics: z
    .array(z.string().trim().min(1).max(BRAND_SETUP_LIMITS.topic))
    .min(1)
    .max(BRAND_SETUP_LIMITS.topics),
});

/**
 * At most `max` UTF-16 units, as zod's max() counts them, never half of an
 * emoji's pair.
 */
function cut(value, max) {
  if (typeof value !== 'string' || value.length <= max) return value;
  const end = /[\uD800-\uDBFF]/.test(value[max - 1]) ? max - 1 : max;
  return value.slice(0, end);
}

/**
 * A stored brand, cut to the same lengths: the Topics page's refresh reads
 * it from the database, where the brand's settings may hold more.
 */
export function boundedBrandSetup({ brandName, industry, description, website }) {
  return {
    brandName: cut(brandName, BRAND_SETUP_LIMITS.name),
    industry: cut(industry, BRAND_SETUP_LIMITS.industry),
    description: cut(description, BRAND_SETUP_LIMITS.description),
    website: cut(website, BRAND_SETUP_LIMITS.website),
  };
}

/**
 * A topic name a model suggested, trimmed and at most
 * BRAND_SETUP_LIMITS.topic characters, cut at a word: the topic's prompts
 * are asked with it (/prompts/from-topics), which refuses a longer one.
 * Empty when there is no name.
 */
export function boundedTopicName(name) {
  const max = BRAND_SETUP_LIMITS.topic;
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length <= max) return trimmed;
  let head = cut(trimmed, max);
  // Ends mid-word: back to the last space, unless that drops most of it.
  if (!/\s/.test(trimmed[head.length])) {
    const space = head.lastIndexOf(' ');
    if (space > max * 0.6) head = head.slice(0, space);
  }
  return head.replace(/[\s,;:&/–—-]+$/, '');
}
