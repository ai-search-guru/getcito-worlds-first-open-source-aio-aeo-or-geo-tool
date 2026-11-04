---
title: Action Priority Score
route: /dashboard/action-center/actions
keywords: [priority score, priority level, critical, why this priority, action ranking]
synonyms: [action priority, ranking, how actions are sorted, urgency]
plan: all
updated: 2026-10-29
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
Every action has a **Priority Score** from 0 to 100: how soon to work on it beside the others. Impact says how much an action could matter; priority weighs impact together with the evidence behind it. The score sets the default order of the **Actions** tab and the **Top Actions** card.

## Priority levels

- **Critical**: 90 and above.
- **High**: 75 to 89.
- **Medium**: 50 to 74.
- **Low**: below 50.

## What goes into the score

- **Impact**: the action's impact grade, high, medium or low.
- **Demand**: how much its prompts, search queries or pages are searched or visited. Only the most demanded few count. A prompt's measured demand level raises it: High more, Medium a little.
- **Severity**: a loss ranks above a sharp drop, a drop above a slip, and a slip above a gap or a site issue.
- **Business value**: how commercial the searches are, or what a page is worth from Google Analytics.
- **Confidence**: how many independent kinds of finding and data sources agree.
- **Recoverability**: ground you held and lost is nearer at hand than ground you never held.
- **Recency**: newer evidence counts more.

Demand or business value that nothing measures neither raises nor lowers the score.

## Past success

On top of these, past success nudges the score: how this brand's own earlier actions of the same kind turned out over the last six months, as the History scorecard counts them. A kind that improved results here sits up to 10 points higher, one that rarely did up to 10 lower. A few results barely move it, and a kind with no results yet doesn't move at all. Other brands' results are never used.

## When the score changes

An action is scored when it is created, and again every night from that night's evidence. When you resolve or dismiss a signal, the actions it supports are scored again right away. An action not scored yet shows a dash and sorts after the scored ones.

An action sent from another page has no detection signals, so it is scored from what it carries, such as the prompts or pages that were sent.

## Why this priority?

The action's **Overview** tab starts with **Why this priority?**: one sentence written from the facts the score rests on. It says what changed, on what, how recently, and what makes it matter. When past success moves the score by a point or more, it says so too.

## Not the Content Plan's score

The Content Plan has its own Priority Score, which ranks the Plan's pages. The two are worked out separately.
