---
title: How mention and sentiment figures are counted
route: /dashboard/mentions
keywords: [total mentions, mention rate, net sentiment, low sample, position, prompts with mentions]
synonyms: [what does net sentiment mean, times named, mention count, sentiment score]
plan: all
updated: 2026-10-29
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/mentions.mdx]
---
Each tracked answer that names your brand is tagged **Positive**, **Neutral** or **Negative** toward your brand. An answer that doesn't name you has no sentiment. Competitors have no sentiment yet, so every tone on the Mentions & Sentiment page is the tone toward your brand.

## Total mentions and mentions

**Total mentions** counts every time an answer names your brand, by its name or one of its domains: an answer that names you three times counts three. The platform table's Mentions column and the exported file count the same way. A mention in the **Mentions** table is different: it is an answer that names you at least once, so an answer naming you twice is still one mention. **Competitor framing** counts responses the same way.

## Rates, sentiment and position

**Mention rate** is the responses naming you divided by the tracked responses in the period. **Prompts with mentions** counts the prompts with at least one answer naming you, out of the prompts tracked. **Net sentiment** is the positive share minus the negative share of the responses naming you, from −100 to +100. Neutral answers count in the total. It is shown as a signed number such as +21, not as a percentage. **Position** is your brand's place among the brands an answer names, 1 meaning named first.

## Low sample

A figure that rests on fewer than 20 responses is marked **Low sample**. For the mention rate that means fewer than 20 tracked responses; for net sentiment, fewer than 20 responses naming you. A low-sample figure is shown without a change from the previous period, isn't tinted in the platform table, and is left out of **Biggest gap**. With so few answers, a single negative response moves the number a lot, so widen the date range or clear a filter before you draw conclusions from it.
