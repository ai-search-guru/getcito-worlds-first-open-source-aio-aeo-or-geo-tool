---
title: Read a site audit report
route: /dashboard/audit
keywords: [audit report, audit score, signals, audit categories, grade, readability, first person]
synonyms: [audit results, page score, what failed, E-E-A-T score, Flesch, Ateşman, reading score, score changed]
plan: all
updated: 2026-11-01
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/site-audit.mdx]
---
Each audit has its own report. It opens right after you run an audit, or from a row on the **Pages** tab. It scores the page out of 100, breaks the score down by category and lists every signal checked. The icons at the top re-run the audit on the same page or delete it; **Delete audit** can't be undone.

## Total score

The gauge shows the page's score out of 100 and a grade: **Good** (70 and above), **Needs work** (40 to 69) or **Poor** (below 40). When the page was audited before, a badge beside the grade shows the change since then, such as "+8 since" that audit's date. Beside it are the number of signals that **passed**, raised **warnings** or **failed**, and how many of the 48 signals were evaluated.

## Categories

**Category breakdown** scores each category out of 100, with how many of its signals were evaluated:

- **Structure** (25%): whether an AI engine can parse the page, such as heading hierarchy, FAQ schema, lists and tables, and alt text.
- **Content** (25%): whether the page answers its question directly and completely.
- **Authority** (20%): whether it reads as expert and sourced, such as author byline, citations, statistics and freshness.
- **E-E-A-T** (20%): experience, expertise and trust, such as case studies and author credentials.
- **Trust** (10%): crawl-time basics such as AI bot access in robots.txt, llms.txt, HTTPS, canonical URL and meta description.

## How the score is worked out

A category's score is the average of its signals, and the total is the weighted average of the categories. A signal that couldn't be evaluated, shown as n/a, is left out, so it never lowers the score.

Most signals are read straight from the page, its robots.txt and its llms.txt. Thirteen, such as **Direct answer to query** and **Case study evidence**, are judged by an AI model that first works out what the page itself is about, so a page is never judged against a topic it isn't trying to cover. **Brand entity in Wikidata** looks your brand up in Wikidata.

## Same page, same score

The AI keeps its verdict on each of its thirteen signals until the part of the page that signal reads changes, so a page audited again with no changes gets the same score. A page that changed is judged again only on the signals whose part changed.

If the AI checks can't run, the page keeps the verdicts of its last audit. A page with none, such as one audited for the first time, gets a partial score: the report says the AI checks couldn't run, and the score leaves them out and isn't compared with your other audits. A partial audit doesn't use one of your monthly audits.

## Signals

The **Signals** section lists every check by category, each with a pass, warning, fail or n/a icon and its impact: **high**, **medium** or **standard**. **Issues only** hides the passing ones. Open a signal to see:

- the **Finding**: what this audit saw on the page, when the check reports it;
- what the signal measures, and **Why** it matters to AI engines;
- the **Recommended fix** written for this page, or the general **Fix** for signals without one. Recommended fixes follow the brand's rules from **Settings › Content › Brand rules**; the score doesn't change.

## Readability

**Readability** reads the page in its own language: the language the page declares, else the one its words are in. English is scored with Flesch Reading Ease: 50 to 70 passes, 30 to 49 and anything over 70 raise a warning, and under 30 fails, so a plain page is never failed for reading easily. Turkish is scored with Ateşman, and German, French and Spanish with their own formulas: their easy score or more passes. Other languages are read by sentence and word length, and Japanese, Chinese and Thai show n/a for now. The Content Editor scores a page the same way.

The finding shows the score with its formula and language, then its parts: words a sentence, syllables and letters a word, and words a paragraph, with about how many lines a paragraph takes on a phone.

## First-person evidence

**First-person evidence** counts the sentences told as "I" or "we": in Turkish also by their verb endings, such as "gezdik" or "düşünüyoruz". Two or more pass and one raises a warning. Quotes and stock phrases such as "Contact us" don't count. It's read in English and Turkish; pages in other languages show n/a for now.

## Authority links

**Outbound authority links** passes with links to 2 authority sites and warns at 1. Open it to see which sites counted, other sites the page links to that don't, and **What counts**: government and academic sites (.gov, .edu and their country forms, such as .gov.tr or .ac.uk), international bodies (any .int site, un.org, europa.eu…), reference and research sites (Wikipedia, doi.org, arXiv…), major news, and the sites your brand trusts. Add those in **Settings › Content**; **Edit in Settings** takes you there.

## Product pages

On a product page, one with Product structured data, **Product description opening** checks that the description's first 40 words, or 250 characters, name the product type and at least two key attributes, such as a measure, a material, a fit or a use. ChatGPT appears to read only about that much of a description when it matches products to a shopping question. The finding shows where the opening ends. Other pages show this signal as n/a.
