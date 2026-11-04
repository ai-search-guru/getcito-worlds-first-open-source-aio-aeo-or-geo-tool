/**
 * Content-category signal evaluators — Faz 1 ships the deterministic ones
 * (readability, length, youtube-embed) and, on product pages, the
 * description's opening (#1279). The query-dependent / LLM-judged
 * signals (direct-answer, BLUF, query / sub-query / entity coverage,
 * info-density, mega-page, definitions) land in a later phase that feeds the
 * brand's tracked prompts in as the target query.
 *
 * See structure.js for the evaluator shape.
 */

import { jsonLd, typesOf } from './helpers.js';
import { UNSPACED, pageProse, readingBand, readingEvidence, readingLevel } from './readability.js';
import { OPENING, checkDescriptionOpening } from '../productDescription.js';

/**
 * The reading level of the page's main content in its language, as the
 * Content Editor imports the page and its Quality reads it
 * (signals/readability.js), so a page scores the same in both: Ateşman for
 * Turkish, Flesch for English…, with its parts as evidence. A page whose
 * content can't be found, or has too few words, gets none: its menus and
 * footer aren't its text. One with no <html lang> is read in the language
 * its words are in, English when they don't say.
 */
export const readability = {
  key: 'readability',
  evaluate(ctx) {
    const { blocks, language, tooLarge } = pageProse(ctx);
    if (tooLarge) {
      return { status: 'na', score: null, evidence: { reason: 'page too large to read' } };
    }
    const lang = language ?? 'en';
    if (UNSPACED.has(lang)) {
      return {
        status: 'na',
        score: null,
        evidence: {
          reason: 'words and sentences are not counted in this language yet',
          language: lang,
        },
      };
    }
    const level = readingLevel(blocks, lang);
    if (level === null) {
      return { status: 'na', score: null, evidence: { reason: 'not enough text' } };
    }
    const { status, score } = readingBand(level);
    return { status, score, evidence: readingEvidence(level) };
  },
};

export const length = {
  key: 'length',
  evaluate(ctx) {
    const words = ctx.wordCount;
    let status = 'fail';
    let score = 0;
    if (words >= 800 && words <= 3000) {
      status = 'pass';
      score = 1;
    } else if ((words >= 400 && words < 800) || (words > 3000 && words <= 5000)) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { words } };
  },
};

export const youtubeEmbed = {
  key: 'youtube-embed',
  evaluate(ctx) {
    const hasEmbed =
      ctx.$(
        'iframe[src*="youtube.com"], iframe[src*="youtube-nocookie.com"], iframe[src*="youtu.be"]',
      ).length > 0;
    return {
      status: hasEmbed ? 'pass' : 'fail',
      score: hasEmbed ? 1 : 0,
      evidence: { youtubeEmbed: hasEmbed },
    };
  },
};

/** A JSON-LD value as plain text: a string, or the name of a node. */
const textOf = (value) =>
  typeof value === 'string' ? value : typeof value?.name === 'string' ? value.name : '';

/**
 * A product page's description opening (#1279): on a page with Product
 * structured data, whether the description's first 40 words or 250
 * characters name the product type and two key attributes. The description
 * is the schema's, else the page's microdata one. Other pages don't count.
 */
export const productDescriptionOpening = {
  key: 'product-description-opening',
  evaluate(ctx) {
    const product = jsonLd(ctx).nodes.find((node) =>
      typesOf(node).some((type) => type === 'product' || type === 'productgroup'),
    );
    if (!product) {
      return { status: 'na', score: null, evidence: { reason: 'not a product page' } };
    }
    const description = (
      textOf(product.description) || ctx.$('[itemprop="description"]').first().text()
    )
      .replace(/<[^>]+>/g, ' ')
      .trim();
    if (!description) {
      return { status: 'na', score: null, evidence: { reason: 'no product description' } };
    }

    const result = checkDescriptionOpening({
      description,
      productName: textOf(product.name),
      brand: textOf(product.brand),
    });
    const typeOk = result.namesType !== false;
    const attributesOk = result.attributes.length >= 2;
    const status = typeOk && attributesOk ? 'pass' : typeOk || attributesOk ? 'warn' : 'fail';
    const last = result.opening.split(' ').slice(-6).join(' ');
    const reason =
      `ChatGPT appears to stop reading a product description after about ${OPENING.words} words ` +
      `or ${OPENING.chars} characters, here at "…${last}". ` +
      `Product type named there: ${result.namesType === null ? 'unknown' : result.namesType ? 'yes' : 'no'}. ` +
      `Key attributes there: ${result.attributes.length ? result.attributes.join(', ') : 'none'}.`;
    return {
      status,
      score: status === 'pass' ? 1 : status === 'warn' ? 0.5 : 0,
      evidence: {
        reason,
        cut: result.cut,
        namesType: result.namesType,
        attributes: result.attributes,
      },
    };
  },
};

export const contentSignals = [readability, length, youtubeEmbed, productDescriptionOpening];
