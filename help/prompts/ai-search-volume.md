---
title: How estimated AI search volume works
route: /dashboard/prompts/insights
keywords: [ai search volume, estimate, confidence, volume range, estimate badge, head terms, opportunity volume]
synonyms: [how many people ask, monthly AI searches, AI volume, est. ai volume]
plan: all
updated: 2026-11-04
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
AI assistants don't publish how often people ask them something, so every AI search volume in GetCito is an estimate. It is shown as a range, such as 540–2k, never as a single number. Totals, averages, a prompt's own page, a content opportunity, the **Prompt Volumes** chart and the Action Center's volumes add a dashed **Estimate** badge; in other tables the range alone marks an estimate.

## How it's estimated

The estimate is the median monthly Google searches for the prompt's related keywords, times the share of Google searches that now get an AI answer (45% by default; a self-hosted server can change it).

When a prompt's volume is analyzed, GetCito picks five short Google keywords for its category and reads their monthly Google searches. Keywords Google has no data for are left out, and the median of the rest is the prompt's **Google Vol. (head terms)**. The Insights tab shows the AI share as **AI Adoption Rate**.

## How the range is set

The range is the AI share of the middle half of the keywords, kept within half to twice the estimate and at least 25% either side of it. With only one keyword to go by, the range is half to twice the estimate.

## Confidence levels

- **High**: at least 3 of the prompt's keywords have Google search data, and the middle half of them are within 4× of each other.
- **Medium**: at least 2 have data, within 15× of each other.
- **Low**: anything else, including an estimate of 0.

Volumes fetched over six months ago count one level less; **Refresh Volumes** on the Insights tab gets newer ones.

## Low-confidence estimates

A low-confidence estimate is grey, its badge reads **Estimate · low confidence**, and it isn't used to rank on its own. **High Opportunity Prompts** leaves it out, and sorting **Tracked Prompts** by **Volume** puts it after the confident estimates, before prompts with no volume.

## Read a range

Hover or focus a range or its badge to open the method note. It says how the estimate was built, how many of the related keywords have Google search data, the sources and their month, and the confidence with its date.

Measured numbers never carry the badge: your visibility, mentions and citations, Search Console clicks and impressions, or a suggestion's Analytics sessions. A range is always an estimate, with or without the badge; a single number without a range was counted, not estimated.

## Totals, single keywords and AI guesses

Some estimates are built differently, and their note says so:

- **Totals and averages** (**Total Est. AI Volume**, **Avg. AI Volume**, and Similar Topics' **Est. AI Volume**): the sum of the lows to the sum of the highs; an average divides both by the prompt count. A total is high-confidence when at least 80% of its volume is, low when more than half is low-confidence, and medium otherwise. The note gives the mix.
- **One keyword** (each row of Similar Topics): only the AI share is assumed, so it is Medium with a ±25% range, or Low when it has no volume or is over six months old.
- **An AI's guess** (suggestions from GetCito Agents, the Brand Visibility page's Opportunities, and the Action Center's topic opportunities): always Low, from half to twice the guess. Track the prompt to get an estimate from its keywords' Google searches.

## A content opportunity's volume

A content opportunity shows the estimate of its question, the prompt it is shown with, and says it is one of the prompts it answers; it isn't their sum. Its score still weighs all of them.

A long question's estimate comes from short head terms for its category, not its own words, so it says **From head terms** and names the closest measured phrase with that phrase's own estimate, often far lower.

## Compare prompts by their ranges

Read volumes as ranges: compare prompts by their confidence as well as their size, and prefer high-confidence estimates when you decide what to work on first.
