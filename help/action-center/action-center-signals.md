---
title: Signals in the Action Center
route: /dashboard/action-center/signals
keywords: [signals, what changed, visibility drop, lost citation, signal status]
synonyms: [alerts, changes, detections, findings]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx, docs/guides/ai-traffic-analytics.mdx]
---
The **Signals** tab lists what changed: a visibility drop, a lost citation, a competitor gaining, a page with no AI traffic, a site issue. Signals are detected after your daily tracking runs, and they are the evidence actions are built from. Many of the same changes also appear in the Daily Pulse email.

## Cards and filters

The cards show Total, Important (high impact), New and Resolved signals, and the average signal impact, for the selected range (7, 30 or 90 days) against the range before.

Filter by category (Visibility, Citation, Mention, Traffic, Technical, Competitor), **Impact**, **Status**, **Source** (AI Results, Google Analytics, Google Search Console, Site Audit) and **Platform**, or search.

## Signal status

A signal is **New**, **Acknowledged**, **Resolved** or **Dismissed**. Set it from the row menu, and use **Reopen** to bring one back. When you resolve or dismiss a signal, the actions it supports get their Priority Score again right away.

## Inside a signal

Click a signal to see:

- **Where** it was found;
- **What changed**: before and after, with the periods compared;
- **Evidence and links**;
- **Related KPIs**;
- **Used by actions**: the actions built from it.

Copies of one finding, such as the same prompt text tracked as several prompts, are grouped into one row and counted once.

## AI traffic signals

The nightly pass also watches AI Referral Traffic and raises these signals:

- **AI visits fell from … to … week over week**: AI visits over the last 7 whole days fell 40% or more from the 7 before, which had at least 30. It feeds **Recover AI traffic**.
- **Broken AI links on …**: in the last 7 days, AI visitors landed on a missing page that AI answers cite, or three or more landed on another missing page. It feeds **Fix broken citation targets**.
- **AI search bots haven't read … that AI answers cite**: needs 30 days of AI-bot data. It feeds **Fix AI crawler accessibility**.
- **… started sending visitors**: an AI platform sent visits for the first time.
