/**
 * Trust-category signal evaluators (7 signals). See structure.js for the
 * evaluator shape.
 */

import { metaContent } from './helpers.js';

const AI_BOTS = [
  'gptbot',
  'oai-searchbot',
  'chatgpt-user',
  'claudebot',
  'anthropic-ai',
  'perplexitybot',
  'google-extended',
];

export const https = {
  key: 'https',
  evaluate(ctx) {
    const isHttps = ctx.protocol === 'https';
    let mixedContentRefs = 0;
    if (isHttps) {
      ctx.$('script[src], link[href], img[src], iframe[src], source[src]').each((_, el) => {
        const ref = ctx.$(el).attr('src') || ctx.$(el).attr('href') || '';
        if (/^http:\/\//i.test(ref)) mixedContentRefs += 1;
      });
    }
    let status = 'fail';
    let score = 0;
    if (isHttps && mixedContentRefs === 0) {
      status = 'pass';
      score = 1;
    } else if (isHttps) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { https: isHttps, mixedContentRefs } };
  },
};

/**
 * robots.txt as its groups: the user agents a group names and whether its
 * rules disallow or allow the whole site. Consecutive user-agent lines share
 * a group; comments and blank lines are skipped. An agent is kept as the
 * crawler matches it: its name in lower case, up to a version ("GPTBot/1.1").
 */
export function robotsGroups(robotsTxt) {
  const groups = [];
  let current = null;
  let agentLine = false;
  for (const raw of String(robotsTxt ?? '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line || !line.includes(':')) continue;
    const at = line.indexOf(':');
    const field = line.slice(0, at).trim().toLowerCase();
    const value = line.slice(at + 1).trim();
    if (field === 'user-agent') {
      if (!current || !agentLine) {
        current = { agents: [], disallowAll: false, allowAll: false };
        groups.push(current);
      }
      const agent = value.toLowerCase();
      current.agents.push(agent.match(/^[a-z_-]+/)?.[0] ?? agent);
      agentLine = true;
    } else {
      agentLine = false;
      if (current && value === '/') {
        if (field === 'disallow') current.disallowAll = true;
        if (field === 'allow') current.allowAll = true;
      }
    }
  }
  return groups;
}

export const aiBotAccess = {
  key: 'ai-bot-access',
  evaluate(ctx) {
    if (!ctx.robotsTxt) {
      // No robots.txt → still crawlable by default, but no explicit signal.
      return { status: 'warn', score: 0.5, evidence: { robotsTxt: false } };
    }
    const lower = ctx.robotsTxt.toLowerCase();
    const mentioned = AI_BOTS.filter((b) => lower.includes(b));
    // An explicit block: the bot's own groups disallow the whole site and
    // none allows it back ("Allow: /" wins a tie). Read group by group, as
    // crawlers do; scanning the text after a bot's name also caught the next
    // group's rules, and blocked a bot that robots.txt allows. The Action
    // Center names the crawlers a block affects.
    const groups = robotsGroups(ctx.robotsTxt);
    const blockedBots = mentioned.filter((b) => {
      const own = groups.filter((g) => g.agents.includes(b));
      return own.some((g) => g.disallowAll) && !own.some((g) => g.allowAll);
    });
    const blocked = blockedBots.length > 0;

    let status = 'warn';
    let score = 0.5;
    if (blocked) {
      status = 'fail';
      score = 0;
    } else if (mentioned.length > 0) {
      status = 'pass';
      score = 1;
    }
    return { status, score, evidence: { aiBotsMentioned: mentioned, blocked, blockedBots } };
  },
};

export const llmsTxtPresence = {
  key: 'llms-txt-presence',
  evaluate(ctx) {
    const present = Boolean(ctx.llmsTxt && ctx.llmsTxt.trim().length > 0);
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { llmsTxt: present },
    };
  },
};

export const canonical = {
  key: 'canonical',
  evaluate(ctx) {
    const href = ctx.$('link[rel="canonical"]').first().attr('href');
    const present = Boolean(href && href.trim());
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { canonical: href || null },
    };
  },
};

export const viewport = {
  key: 'viewport',
  evaluate(ctx) {
    const present = Boolean(metaContent(ctx, 'viewport'));
    return {
      status: present ? 'pass' : 'fail',
      score: present ? 1 : 0,
      evidence: { viewport: present },
    };
  },
};

export const twitterCard = {
  key: 'twitter-card',
  evaluate(ctx) {
    const card = metaContent(ctx, 'twitter:card');
    const image = metaContent(ctx, 'twitter:image');
    let status = 'fail';
    let score = 0;
    if (card && image) {
      status = 'pass';
      score = 1;
    } else if (card) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { card: card || null, hasImage: Boolean(image) } };
  },
};

export const metaDescription = {
  key: 'meta-description',
  evaluate(ctx) {
    const desc = metaContent(ctx, 'description');
    const len = desc ? desc.length : 0;
    let status = 'fail';
    let score = 0;
    if (len >= 80 && len <= 160) {
      status = 'pass';
      score = 1;
    } else if (len > 0) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { length: len } };
  },
};

export const trustSignals = [
  https,
  aiBotAccess,
  llmsTxtPresence,
  canonical,
  viewport,
  twitterCard,
  metaDescription,
];
