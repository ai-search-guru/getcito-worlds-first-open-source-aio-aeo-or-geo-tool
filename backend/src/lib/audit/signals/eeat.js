/**
 * E-E-A-T-category signal evaluators — Faz 1 ships the 3 deterministic ones
 * (first-person, privacy-terms, contact-info). The LLM / external-data signals
 * (case-study-evidence, author-credentials, byline-depth, brand-entity via
 * Wikidata, press-mentions) land in later phases.
 *
 * See structure.js for the evaluator shape.
 */

import { FIRST_PERSON_LANGUAGES, speaksFirstPerson } from './firstPerson.js';
import { pageProse, sentencesOf } from './readability.js';

/**
 * Sentences of the page's own text told in the first person (firstPerson.js):
 * two pass, one warns. Its main content as readability reads it (a quote
 * aside), else its whole text; in its language, English when its words
 * don't say. A language first person isn't read in yet has no score.
 */
export const firstPerson = {
  key: 'first-person',
  evaluate(ctx) {
    const { blocks, language } = pageProse(ctx);
    const own = blocks.filter((b) => b.tag === 'p' || b.tag === 'li');
    const lang = language ?? 'en';
    if (!FIRST_PERSON_LANGUAGES.has(lang)) {
      return {
        status: 'na',
        score: null,
        evidence: {
          reason: 'first person is read in English and Turkish only, for now',
          language: lang,
        },
      };
    }
    const sentences = own.length
      ? own.flatMap((b) => sentencesOf(b.text, lang))
      : sentencesOf(ctx.text ?? '', lang);
    const told = sentences.filter((s) => speaksFirstPerson(s, lang));
    const hits = told.length;
    let status = 'fail';
    let score = 0;
    if (hits >= 2) {
      status = 'pass';
      score = 1;
    } else if (hits === 1) {
      status = 'warn';
      score = 0.5;
    }
    return {
      status,
      score,
      evidence: { language: lang, firstPersonSentences: hits, sentences: sentences.length },
    };
  },
};

export const privacyTerms = {
  key: 'privacy-terms',
  evaluate(ctx) {
    let privacy = false;
    let terms = false;
    ctx.$('a[href]').each((_, el) => {
      const href = (ctx.$(el).attr('href') || '').toLowerCase();
      const text = ctx.$(el).text().toLowerCase();
      const blob = `${href} ${text}`;
      if (/privacy/.test(blob)) privacy = true;
      if (/terms|tos\b|conditions/.test(blob)) terms = true;
    });
    let status = 'fail';
    let score = 0;
    if (privacy && terms) {
      status = 'pass';
      score = 1;
    } else if (privacy || terms) {
      status = 'warn';
      score = 0.5;
    }
    return { status, score, evidence: { privacy, terms } };
  },
};

export const contactInfo = {
  key: 'contact-info',
  evaluate(ctx) {
    const hasMailto = ctx.$('a[href^="mailto:"]').length > 0;
    const hasTel = ctx.$('a[href^="tel:"]').length > 0;
    let contactLink = false;
    ctx.$('a[href]').each((_, el) => {
      const blob = `${(ctx.$(el).attr('href') || '').toLowerCase()} ${ctx.$(el).text().toLowerCase()}`;
      if (/contact|iletişim|kontakt/.test(blob)) contactLink = true;
    });
    const emailInText = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i.test(ctx.text);

    const found = hasMailto || hasTel || contactLink || emailInText;
    return {
      status: found ? 'pass' : 'fail',
      score: found ? 1 : 0,
      evidence: { mailto: hasMailto, tel: hasTel, contactLink, emailInText },
    };
  },
};

export const eeatSignals = [firstPerson, privacyTerms, contactInfo];
