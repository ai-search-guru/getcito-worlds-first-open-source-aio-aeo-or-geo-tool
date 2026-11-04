---
title: A prompt's own page and its real demand
route: /dashboard/prompts/tracked
keywords: [prompt page, prompt detail, demand, google trends, people also ask, search console]
synonyms: [single prompt view, is this asked for real, real demand, prompt results]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
Click a prompt's text in **Tracked Prompts** to open its own page. It shows the prompt's visibility, mentions, citations and per-platform results. When the prompt has a volume, an **AI searches a month** card shows its estimate. Below the figures, **Demand · is this asked for real?** shows measured signals of whether people really ask it.

## The four demand signals

Each signal shows its source and the day it was read:

- **Search Console**: impressions and clicks over the last 28 days for your Google queries that match the prompt, how many matched and the most seen one. Read every night.
- **Google Trends**: a 12-month line for the prompt's keyword, **Rising**, **Steady** or **Falling**, and the change on a year ago. Read about once a week.
- **People Also Ask**: the related questions Google shows for the keyword. Read about once a week.
- **YouTube**: the views across YouTube's top videos for the keyword, and the most viewed one. Read about once a week.

A query matches a prompt when at least half of its words are in the prompt, and counts for the closest prompt only.

## When a signal is missing

Google Trends, People Also Ask and YouTube are read for the keyword with the most Google searches in the prompt's volume analysis, so the prompt needs its volume analyzed first. These weekly reads are off by default, and a self-hosted server can turn them on; until then their cards say **Weekly reads aren't turned on yet**. Search Console is read every night either way.

A card without its signal says why, for example **Connect Search Console to see real clicks** (with a **Connect Search Console** button for admins and managers), the first sync still running, or **Analyze volume first**.

## Track a People Also Ask question

Each People Also Ask question has a **+ Track** button for admins and managers. One click adds it as a tracked prompt in the prompt's topic, within your plan's prompt limit. A question your brand already tracks, even with different capitals, accents or punctuation, shows **Tracked** instead and isn't added twice.

## Demand level

The signals read come to a demand level, shown in the KPI row as **Demand · 3 of 4 signals** with the level, for example **High**. It carries a **Measured** badge, never **Estimate**.

## How the demand level is scored

Each signal read gives 2 points when it's strong, 1 when there is some, 0 otherwise:

- **Search Console**: 1,000 impressions or more is strong, 100 or more is some.
- **Google Trends**: rising is strong, steady is some.
- **People Also Ask**: 4 questions or more is strong, 1 or more is some.
- **YouTube**: 100,000 views or more is strong, 5,000 or more is some.

The level is **High** at 60% of the possible points or more with at least two signals read, **Medium** at 30% or more, and **Low** below. A signal that was read and found nothing counts; one never read doesn't.

## Demand and the Priority Score

The demand level feeds the Priority Score of the Action Center's actions about the prompt. **High** raises its demand to at least what about 2,500 monthly AI searches would give, and **Medium** to about 160. **Low** leaves it as it is, because signals that found little don't prove nobody asks.

When a prompt's level changes, the brand's open actions are scored again that night, and **Why this priority?** names a High or Medium level.
