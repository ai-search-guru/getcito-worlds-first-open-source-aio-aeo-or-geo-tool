/**
 * Structure-category signal evaluators (13 signals).
 *
 * Each evaluator is `{ key, evaluate(ctx) => { status, score, evidence } }`:
 *   - status: 'pass' | 'warn' | 'fail' | 'na'
 *   - score:  0..1 (null when 'na')
 *   - evidence: small object surfaced in the UI to explain the verdict
 *
 * Rubric copy (label/what/why/howToFix) is merged in from rubric.js at
 * response-assembly time, so evaluators stay purely about measurement.
 */

import { jsonLd, typesOf, classifyLinks, metaContent } from './helpers.js';

// schema.org types that signal a specific, AI-citable content intent.
const HIGH_VALUE_TYPES = new Set([
  'article',
  'newsarticle',
  'blogposting',
  'product',
  'faqpage',
  'howto',
  'recipe',
  'review',
  'qapage',
  'techarticle',
  'medicalwebpage',
  'event',
  'softwareapplication',
]);

export const structuralDepth = {
  key: 'structural-depth',
  evaluate(ctx) {
    const levels = ctx.$('h1, h2, h3, h4, h5, h6');
    const present = new Set();
    let skips = 0;
    let prev = 0;
    levels.each((_, el) => {
      const lvl = Number(el.tagName.replace(/[^1-6]/g, ''));
      present.add(lvl);
      if (prev && lvl > prev + 1) skips += 1;
      prev = lvl;
    });
    const depth = present.size;
    const hasNesting = present.has(1) && present.has(2) && present.has(3);

    let status = 'fail';
    let score = 0.2;
    if (hasNesting && skips === 0) {
      status = 'pass';
      score = 1;
    } else if (depth >= 2) {
      status = 'warn';
      score = 0.6;
    }
    return { status, score, evidence: { depth, levelSkips: skips, levels: [...present].sort() } };
  },
};

export const internalLinking = {
  key: 'internal-linking',
  evaluate(ctx) {
    const { internal } = classifyLinks(ctx);
    const count = internal.length;
    let status = 'fail';
    let score = 0;
    if (count >= 5) {
      status = 'pass';
      score = 1;
    } else if (count >= 1) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { internalLinks: count } };
  },
};

export const pageWeight = {
  key: 'page-weight',
  evaluate(ctx) {
    const kb = Math.round(ctx.htmlBytes / 1024);
    let status = 'pass';
    let score = 1;
    if (kb > 1024) {
      status = 'fail';
      score = 0;
    } else if (kb > 500) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { htmlKb: kb } };
  },
};

export const jsonLdPresence = {
  key: 'json-ld-presence',
  evaluate(ctx) {
    const { total } = jsonLd(ctx);
    return {
      status: total > 0 ? 'pass' : 'fail',
      score: total > 0 ? 1 : 0,
      evidence: { blockCount: total },
    };
  },
};

export const jsonLdValidity = {
  key: 'json-ld-validity',
  evaluate(ctx) {
    const { nodes, total, valid } = jsonLd(ctx);
    if (total === 0) {
      return { status: 'fail', score: 0, evidence: { reason: 'no JSON-LD blocks' } };
    }
    // Among parsed nodes, how many declare a schema.org @context + a @type?
    // A @graph's nodes share their wrapper's context: read each context once.
    const schemaOrg = new Map();
    const declaresSchemaOrg = (context) => {
      if (!schemaOrg.has(context)) {
        schemaOrg.set(
          context,
          JSON.stringify(context ?? '')
            .toLowerCase()
            .includes('schema.org'),
        );
      }
      return schemaOrg.get(context);
    };
    const wellFormed = nodes.filter(
      (n) => declaresSchemaOrg(n['@context']) && typesOf(n).length > 0,
    ).length;

    let status = 'fail';
    let score = 0;
    if (valid === total && wellFormed > 0) {
      status = 'pass';
      score = 1;
    } else if (valid > 0 && wellFormed > 0) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: { blocks: total, parsed: valid, wellFormedNodes: wellFormed },
    };
  },
};

export const jsonLdRelevance = {
  key: 'json-ld-relevance',
  evaluate(ctx) {
    const { nodes } = jsonLd(ctx);
    const allTypes = nodes.flatMap(typesOf);
    if (allTypes.length === 0) {
      return { status: 'fail', score: 0, evidence: { types: [] } };
    }
    const hasHighValue = allTypes.some((t) => HIGH_VALUE_TYPES.has(t));
    return {
      status: hasHighValue ? 'pass' : 'warn',
      score: hasHighValue ? 1 : 0.5,
      evidence: { types: [...new Set(allTypes)].slice(0, 8) },
    };
  },
};

export const faqSchema = {
  key: 'faq-schema',
  evaluate(ctx) {
    const { nodes } = jsonLd(ctx);
    const faq = nodes.find((n) => typesOf(n).includes('faqpage'));
    const qa = faq && Array.isArray(faq.mainEntity) ? faq.mainEntity.length : 0;
    const ok = Boolean(faq) && qa >= 2;
    return {
      status: ok ? 'pass' : 'fail',
      score: ok ? 1 : 0,
      evidence: { faqPage: Boolean(faq), questionCount: qa },
    };
  },
};

export const h1Quality = {
  key: 'h1-quality',
  evaluate(ctx) {
    const h1s = ctx.$('h1');
    const count = h1s.length;
    const text = h1s.first().text().replace(/\s+/g, ' ').trim();
    const length = text.length;
    const exactlyOne = count === 1;
    const idealLength = length >= 20 && length <= 70;

    let status = 'fail';
    let score = 0;
    if (exactlyOne && idealLength) {
      status = 'pass';
      score = 1;
    } else if (count >= 1 && length >= 10 && length <= 90) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { count, length, text: text.slice(0, 120) } };
  },
};

export const h2Coverage = {
  key: 'h2-coverage',
  evaluate(ctx) {
    const count = ctx.$('h2').length;
    let status = 'fail';
    let score = 0;
    if (count >= 3) {
      status = 'pass';
      score = 1;
    } else if (count >= 1) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { h2Count: count } };
  },
};

export const lists = {
  key: 'lists',
  evaluate(ctx) {
    let withThree = 0;
    let any = 0;
    ctx.$('ul, ol').each((_, el) => {
      any += 1;
      if (ctx.$(el).children('li').length >= 3) withThree += 1;
    });
    let status = 'fail';
    let score = 0;
    if (withThree >= 1) {
      status = 'pass';
      score = 1;
    } else if (any >= 1) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { lists: any, listsWith3PlusItems: withThree } };
  },
};

export const tables = {
  key: 'tables',
  evaluate(ctx) {
    const total = ctx.$('table').length;
    const structured = ctx.$('table').filter((_, el) => {
      const $t = ctx.$(el);
      return $t.find('thead').length > 0 && $t.find('tbody').length > 0;
    }).length;
    let status = 'fail';
    let score = 0;
    if (structured >= 1) {
      status = 'pass';
      score = 1;
    } else if (total >= 1) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { tables: total, structuredTables: structured } };
  },
};

export const altText = {
  key: 'alt-text',
  evaluate(ctx) {
    const imgs = ctx.$('img');
    const total = imgs.length;
    if (total === 0) {
      return { status: 'na', score: null, evidence: { images: 0 } };
    }
    let withAlt = 0;
    imgs.each((_, el) => {
      const alt = ctx.$(el).attr('alt');
      if (typeof alt === 'string' && alt.trim().length > 0) withAlt += 1;
    });
    const ratio = withAlt / total;
    let status = 'fail';
    let score = ratio;
    if (ratio >= 0.8) status = 'pass';
    else if (ratio >= 0.5) status = 'warn';
    return {
      status,
      score: Number(score.toFixed(2)),
      evidence: { images: total, withAlt, ratio: Number(ratio.toFixed(2)) },
    };
  },
};

export const openGraph = {
  key: 'open-graph',
  evaluate(ctx) {
    const tags = ['og:title', 'og:description', 'og:image', 'og:type'];
    const present = tags.filter((t) => metaContent(ctx, t));
    const n = present.length;
    let status = 'fail';
    let score = 0;
    if (n === 4) {
      status = 'pass';
      score = 1;
    } else if (n >= 1) {
      status = 'warn';
      score = n / 4;
    }
    return {
      status,
      score: Number(score.toFixed(2)),
      evidence: { present, missing: tags.filter((t) => !present.includes(t)) },
    };
  },
};

export const structureSignals = [
  structuralDepth,
  internalLinking,
  pageWeight,
  jsonLdPresence,
  jsonLdValidity,
  jsonLdRelevance,
  faqSchema,
  h1Quality,
  h2Coverage,
  lists,
  tables,
  altText,
  openGraph,
];
