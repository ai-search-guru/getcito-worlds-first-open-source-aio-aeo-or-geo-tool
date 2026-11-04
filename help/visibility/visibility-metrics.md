---
title: What visibility, position, mentions and citations mean
route: /dashboard/insights
keywords: [visibility score, position, mentions, citations, coverage, share of voice, citation rate, net sentiment, performance]
synonyms: [metrics explained, what is visibility, ranking in AI answers, why is my score zero, what is coverage, what is share of voice]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/answer-engine-insights.mdx, docs/concepts/visibility-scoring.mdx, docs/guides/prompts.mdx, docs/guides/add-your-first-brand.mdx]
---
GetCito describes how AI answers treat your brand with a few metrics: visibility, mentions, citations, position and the rates built on them. They are counted from real AI answers, not estimated, so they never carry an **Estimate** badge.

## Read your visibility score

Visibility is a score from 0 to 100, not a percentage. It blends how often AI answers mention your brand, how often they cite your site and how early they name you; **Formulas** on **Brand Visibility** shows the exact formula. A rough guide, not bands the app shows:

- **Under 15**: cold start. AI engines barely know the brand on these prompts.
- **15 to 35**: emerging presence. AI sometimes mentions you, but competitors dominate.
- **35 to 60**: established. You're reliably mentioned; focus on the one or two platforms or topics still trailing.
- **Over 60**: category leader. Your job is defending your place against new entrants.

The right threshold depends on how competitive the category is: in a crowded category, 20 can already be leadership.

## Watch the change, not the number

Don't fixate on the absolute number; watch how it moves. A brand growing from 18 to 24 in a quarter is healthier than one stuck at 50.

Every change compares the selected range with the period of the same length just before it, over only the prompts answered in both. Visibility changes are in points; Mentions and Citations change in percent.

## A score of 0

A score of 0 doesn't mean something is broken. New, niche or B2B brands often start at 0 on most prompts. AI engines need either plenty of training data that mentions your brand or live citations from trusted sources, and the score stays at 0 only while both are missing.

## Coverage, share of voice and the other rates

The key metric cards on **Brand Visibility** also show:

- **Coverage**: the share of answered prompts where you appear at least once.
- **Share of voice**: your mentions out of all mentions of tracked brands.
- **Avg. position**: where you're named in the answers that name you. Lower is better.
- **Citation rate**: the share of answers that cite your domain.
- **Net sentiment**: the positive minus the negative share of the answers that name you.

A rate based on fewer than 20 answers says **Low sample** and shows no change.

## Position and Performance

Position is where your brand is named among the brands an AI answer lists; named earlier is better. The **Performance** filter in **Tracked Prompts** groups prompts by it, over the selected range and across every platform the prompt tracks:

- **Best**: named in the first third of the brands an answer lists.
- **Good**: in the middle third.
- **Late**: in the last third.
- **Missing**: named in fewer than half the answers.

A prompt with no answers in the range, such as a new one, has no performance yet. The **Positions** column shows your average position and its change; hover it for each platform.

## Mentions and citations

A mention is each time an AI answer names your brand or your domain; one answer can add several. The **Mentions** card counts them. Mention detection ignores upper and lower case, so name the brand exactly as it's named in the wild, not by an abbreviation.

A citation is a source page that comes with an AI answer. The **Citations** card counts how often answers cited your pages, and the **Citations** page shows which domains and pages AI engines cite for your prompts.

## Prompts that skew your metrics

Prompts that include your brand name almost always score high, because the AI obviously talks about you when asked. They don't measure how AI engines discover you on their own, and they distort your averages, so keep tracked prompts free of your brand name.
