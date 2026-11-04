---
title: How the AI Visibility Score is calculated
route: /dashboard/insights
keywords: [AI Visibility Score, visibility formula, mention rate, citation rate, position, score calculation, formulas]
synonyms: [how is visibility calculated, score weights, what makes up my score, visibility math, how the score works]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/concepts/visibility-scoring.mdx, docs/guides/answer-engine-insights.mdx, docs/guides/competitors.mdx]
---
The **AI Visibility Score** is a score from 0 to 100, not a percentage. It blends three things over the answers in your date range and filters: how many answers name your brand, how many cite a page of yours, and how early you're named. A score of 0 means no answer names or cites you; the closer every answer comes to naming you first and citing you, the closer the score gets to 100. **Formulas** on **Brand Visibility** shows the exact formula.

## The three parts

- **Mention rate (60%)**: the share of answers that name your brand.
- **Citation rate (25%)**: the share of answers that cite a page of yours.
- **Position (15%)**: how early you're named, in the answers that name you. Being named first counts 1, second a half, third a third, and so on, averaged. While only a few answers name you, this part counts for less, so one lucky first place can't lift the score on its own.

The score is 100 times the sum of 0.6 × mention rate, 0.25 × citation rate and 0.15 × the position part (reduced while few answers name you), to one decimal. All three parts read the same answers, so the filters you set apply to each of them.

## Every answer counts

Every answer counts, including the ones that leave you out. Competitors are scored the same way over the same answers, so their numbers are directly comparable with yours.

## A single answer's score

Each answer also gets its own score from 0 to 100, shown with that answer:

- up to 40 points for naming you, 10 per mention;
- up to 30 for citing you, 15 per citation;
- up to 15 for your share of the answer's citations;
- up to 15 for its tone: 15 when positive, 7 when neutral and you're named.

The head-to-head comparison on the **Competitors** page averages these per-answer scores.

## Comparing periods

The change shown beside a score, in green or red, compares your date range with the period before it, **vs previous period**. It uses only the prompts answered in both periods, so the comparison is like for like.

## Where you see the score

- **Brand Visibility**: the brand's score, its trend and the change vs the previous period.
- **Tracked Prompts** under **Prompts**: each prompt's score.
- **Topics** under **Prompts**: each topic's score, and **Topics vs competitors** on Brand Visibility.
- **Competitors**: each tracked competitor's score beside yours.

## What moves your score

Typical effects, not guarantees:

- Publishing a citation-friendly comparison page: up, over one to four weeks as AI engines re-index.
- Earning coverage on a major review or list site: up within two to seven days, often at once.
- Losing a press citation, such as a retracted article: down within a week.
- A competitor outpacing you with better structured data: your relative score declines.
- Adding new prompts to your tracked set: the score may dip until those prompts mature.

## What doesn't move your score

The score reads only AI answers, so work that doesn't change them doesn't move it, for example:

- backlinks without on-page content;
- how often you post on social media, which AI engines usually weigh less than published content;
- traditional SEO work that doesn't address how AI engines pick content.

As a rough guide, not a promise, a focused program in a competitive category often gains 5 to 10% a month, relative to its score. Faster growth usually needs a major press placement or a structural content investment.
