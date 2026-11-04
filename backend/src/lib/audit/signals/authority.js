/**
 * Authority-category signal evaluators (8 signals; technical-terms is deferred
 * to a later LLM phase). See structure.js for the evaluator shape.
 */

import { authorityKind } from '../authoritySources.js';
import { jsonLd, classifyLinks, metaContent } from './helpers.js';

/** Collect candidate dates (ms) from JSON-LD, <time datetime>, and OG meta. */
function collectDates(ctx) {
  const out = [];
  const push = (v) => {
    if (!v || typeof v !== 'string') return;
    const t = Date.parse(v);
    if (!Number.isNaN(t)) out.push(t);
  };

  const { nodes } = jsonLd(ctx);
  for (const n of nodes) {
    push(n.datePublished);
    push(n.dateModified);
  }
  ctx.$('time[datetime]').each((_, el) => push(ctx.$(el).attr('datetime')));
  push(metaContent(ctx, 'article:published_time'));
  push(metaContent(ctx, 'article:modified_time'));

  return out;
}

/** Other sites the report names beside what counted, for "why doesn't mine count". */
const OTHER_HOSTS_SHOWN = 5;

export const outboundAuthorityLinks = {
  key: 'outbound-authority-links',
  evaluate(ctx) {
    const { external } = classifyLinks(ctx);
    const hosts = [...new Set(external.map((u) => u.hostname.toLowerCase().replace(/^www\./, '')))];
    // The brand's own trusted sources (00449), read with the brand for its run.
    const trusted = Array.isArray(ctx.trustedSources) ? ctx.trustedSources : [];
    const kinds = Object.fromEntries(
      hosts.flatMap((host) => {
        const kind = authorityKind(host, trusted);
        return kind ? [[host, kind]] : [];
      }),
    );
    const authority = Object.keys(kinds);
    const others = hosts.filter((host) => !kinds[host]).slice(0, OTHER_HOSTS_SHOWN);
    const count = authority.length;
    let status = 'fail';
    let score = 0;
    if (count >= 2) {
      status = 'pass';
      score = 1;
    } else if (count === 1) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: {
        authorityHosts: authority.slice(0, 8),
        count,
        // What each counted as (authoritySources.js), and sites that didn't count.
        authorityKinds: Object.fromEntries(authority.slice(0, 8).map((h) => [h, kinds[h]])),
        otherHosts: others,
        // The brand's trusted sources this run counted, as the report lists them.
        trustedSources: trusted,
      },
    };
  },
};

export const citationDensity = {
  key: 'citation-density',
  evaluate(ctx) {
    const { external } = classifyLinks(ctx);
    const per1000 = ctx.wordCount > 0 ? (external.length / ctx.wordCount) * 1000 : 0;
    let status = 'fail';
    let score = 0;
    if (per1000 >= 2) {
      status = 'pass';
      score = 1;
    } else if (per1000 >= 1) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: {
        outboundLinks: external.length,
        words: ctx.wordCount,
        per1000Words: Number(per1000.toFixed(1)),
      },
    };
  },
};

export const statisticDensity = {
  key: 'statistic-density',
  evaluate(ctx) {
    // Quantitative tokens: percentages, currency, or standalone numbers.
    const matches =
      ctx.text.match(/(\$|€|£|₺|%)?\s?\d[\d.,]*\s?(%|percent|million|billion|k\b)?/gi) || [];
    const numeric = matches.filter((m) => /\d/.test(m)).length;
    const per1000 = ctx.wordCount > 0 ? (numeric / ctx.wordCount) * 1000 : 0;
    let status = 'fail';
    let score = 0;
    if (per1000 >= 3) {
      status = 'pass';
      score = 1;
    } else if (per1000 >= 1.5) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: { numericClaims: numeric, per1000Words: Number(per1000.toFixed(1)) },
    };
  },
};

export const quotations = {
  key: 'quotations',
  evaluate(ctx) {
    const count = ctx.$('blockquote, q').length;
    return {
      status: count >= 1 ? 'pass' : 'fail',
      score: count >= 1 ? 1 : 0,
      evidence: { quotations: count },
    };
  },
};

export const authorByline = {
  key: 'author-byline',
  evaluate(ctx) {
    const { nodes } = jsonLd(ctx);
    const schemaAuthor = nodes.some((n) => {
      const a = n.author;
      if (!a) return false;
      const list = Array.isArray(a) ? a : [a];
      return list.some((x) => (typeof x === 'string' ? x.trim() : x?.name));
    });
    const metaAuthor = Boolean(metaContent(ctx, 'author'));
    const relAuthor = ctx.$('a[rel="author"], [class*="byline" i], [class*="author" i]').length > 0;
    const textByline = /\bby\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/.test(ctx.text.slice(0, 2000));

    const found = schemaAuthor || metaAuthor || relAuthor || textByline;
    return {
      status: found ? 'pass' : 'fail',
      score: found ? 1 : 0,
      evidence: { schemaAuthor, metaAuthor, relAuthor, textByline },
    };
  },
};

export const dateMarkup = {
  key: 'date-markup',
  evaluate(ctx) {
    const dates = collectDates(ctx);
    const found = dates.length > 0;
    return {
      status: found ? 'pass' : 'fail',
      score: found ? 1 : 0,
      evidence: { dateSignals: dates.length },
    };
  },
};

export const freshness = {
  key: 'freshness',
  evaluate(ctx) {
    const dates = collectDates(ctx);
    if (dates.length === 0) {
      return { status: 'fail', score: 0, evidence: { reason: 'no date markup' } };
    }
    const newest = Math.max(...dates);
    const ageDays = Math.floor((ctx.now - newest) / (1000 * 60 * 60 * 24));
    let status = 'fail';
    let score = 0;
    if (ageDays <= 365) {
      status = 'pass';
      score = 1;
    } else if (ageDays <= 730) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: { ageDays, newest: new Date(newest).toISOString().slice(0, 10) },
    };
  },
};

export const authoritySignals = [
  outboundAuthorityLinks,
  citationDensity,
  statisticDensity,
  quotations,
  authorByline,
  dateMarkup,
  freshness,
];
