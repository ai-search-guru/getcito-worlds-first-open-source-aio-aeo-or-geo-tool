---
title: Action history and results
route: /dashboard/action-center/history
keywords: [history, action results, scorecard, success rate, measured outcome]
synonyms: [what worked, past actions, completed actions, did it work]
plan: all
updated: 2026-10-29
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/action-center.mdx]
---
The **History** tab lists actions once they are In Progress, On Hold, Completed or Dismissed, with what they were meant to do and what has been measured since. A result is measured after the action, not proven to be caused by it.

## Find an action in History

Filter by range (7d, 30d, 90d, All), **Status**, **Type**, **Priority** and **Source**, and sort by Newest, Oldest or Priority. The cards count total, completed, in-progress, no-improvement and dismissed actions in the window.

Click an action to see **What was the goal?**, **What happened?** (the signals it was built from), its affected items and tasks, and its **Result**.

## How a result is measured

Only a completed action is measured. Its metrics are read three times, over the week ending 7, 14 and 30 days after it closed, each against the 7 days before it was raised. Until the final reading on day 30, the result reads *so far*, and the drawer lists each reading.

An action that names its prompts or pages is measured on them, with the brand-wide figures beside. Its prompts' change is also shown net of the brand's prompts it didn't touch, so a change that hit every prompt, such as an engine's update, is told apart from its own. A Site Audit fix is judged by its pages audited again since it closed.

## What a result means

- **Improved**, **Mixed**, **No meaningful change** or **Declined**: judged by the action's main metric, the first one it names. **Mixed** means another metric it names moved the other way.
- **Not measured**: the action was dismissed.
- **Not measurable**: it has no metric to read, or its main metric is mentions or citations and tracking missed more than two nights in one of its weeks.

The drawer also says what became of the signals that raised it: how many ended, turned into another, were dismissed, or are still open.

## Actions sent from Improve

An action sent from a prompt's Improve tab reports on how many platforms its position improved. It is read again daily while the action is open, and for 30 days after it is completed.

## The Scorecard

Switch History from **Actions** to **Scorecard** to see what each kind of action did at this brand over the range, 90 days unless you pick another. It shows how many were completed, their results so far, the **Success rate** (the share of results that improved, shown once a kind has three), the median change in each action's main metric, and how many were dismissed, with the reason given most often. It counts this brand's own actions only.

## When a problem comes back

When an action is closed, its condition can open a new action after a two-week rest if it is still firing. The old one stays in History as the record of that round of work.
