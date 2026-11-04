---
title: Find content opportunities
route: /dashboard/content
keywords: [content opportunities, opportunity score, impact, visibility gap, content ideas, export csv, filter opportunities, bulk actions]
synonyms: [content optimization, content gaps, what to write, content suggestions]
plan: all
updated: 2026-11-04
last_checked: 2026-11-03
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-optimization.mdx, docs/guides/content-editor.mdx]
---
The **Opportunities** page, under **Content** in the sidebar, lists content opportunities: what to write or change so AI answers name you where they don't yet. GetCito suggests them on its own as tracking data comes in. An opportunity is built for a group of related prompts that one piece of content can answer, or for a single prompt. From each one you can start writing, plan it, brief it or send it on.

## What each row shows

- the action to take, with what it was built for: a topic and its number of prompts, **Single prompt**, or the Action Center action it came from;
- when it was **Suggested**, with a dot on the rows suggested since your last visit;
- its **Type**: **Owned** or **Earned**, and, where it applies, what to do with your page: Create, Optimize, Expand, Refresh, Consolidate or Defend;
- its **Impact**, **High**, **Medium** or **Low**, which GetCito rates when it writes the opportunity, and its **Score**, from 0 to 100;
- its **Status**: New, Reviewed, Sent to Workflow, In Progress, Done, Dismissed or Archived.

Above the list, cards count the **Total Opportunities** and the **High Impact** ones, and give the **Avg. Score**. On plans with monthly limits, **This billing period** shows how many new opportunities and content briefs are left, and when they reset.

## Filter, sort and export

- Search the opportunities, and narrow the list by topic, prompt, type, impact, **Source** and status. The sources are **System**, suggested automatically; **Manual**, made with **New**; **Prompt**, suggested from a prompt; and **Action**, sent from an Action Center task.
- **Suggested** picks a period, all time, this month, the last 30 days or your own dates, and the order: highest score, newest or oldest.
- Archived opportunities stay hidden unless you filter to them.
- Most filters and the order stay in the page's address, so a link opens the same view; the topic and the search don't.
- **Export CSV** downloads every opportunity that matches the filters and the search, not only the page you see.

## Quick actions on a row

Each row's **…** menu has the quick actions:

- **Write this**, which has the Content Agent brief and write the page in one go for you to review, and **Send to Editor**; **Open draft** takes their place once a draft is being written for it;
- **Send to Plan**, or **Open in Plan** once it's a priority there, for owned opportunities still open;
- **Send to Workflow**, for a new opportunity;
- **Open in new tab**, which opens it as a page of its own;
- **Dismiss**, for a new one. Undo it from the message that appears.

Send to Plan and Dismiss are for admins and managers. Click an opportunity's title to open it in a panel beside the list, with all its data and the rest of its actions.

## Work on many at once

Tick rows, or the box in the header for every row shown, then:

- **Send All** sends each one to your workflow tool, which suits kicking off a content sprint.
- **Done**, **Dismiss All** and **Delete** change them all at once. They're for admins and managers.

**Delete** removes the opportunities for good, with any brief they have, and doesn't give back the month's opportunities or briefs. Dismissing keeps them out of your way instead.

## Ask for new opportunities

Admins and managers click **New** to get suggestions now, instead of waiting for the next automatic run. Pick a **Focus**: **Let GetCito choose**, a **Topic** or a **Prompt**. You can add your own idea, up to 500 characters, and set **How many**. New opportunities also follow the brand's rules from **Settings › Content › Brand rules**, such as topics to stay away from.

Opportunities are written per group of prompts: prompts of one topic that a single page could answer, and that already have tracked answers. Each group gets one opportunity; only **Another angle** adds a second take on it.

Titles leave years out unless the need is about one. A year that has passed in an opportunity's title or question shows as this year; your tracked prompts keep their own words.

## What each focus picks

- **Let GetCito choose** takes the highest-scoring groups that have no opportunity yet, one from each topic first.
- **Topic** takes only that topic's groups. Each topic in the list shows how many new groups it has, or **All covered**.
- **Prompt** takes only that prompt's group, so it writes at most one opportunity, and **How many** stays at 1. If the group already has an open opportunity, the dialog says so and offers **Open existing** instead; prompts like that show **Has one** in the list. A prompt whose opportunity was dismissed or done can be asked for again.

## How many are left

The dialog shows how many groups in your focus have no opportunity yet, and **How many** goes no higher. When none are left, it says so and **Generate** stays off: add prompts for new groups, or use **Another angle** on an opportunity. Groups without tracked answers from the last 30 days have nothing to write from yet.

## No duplicates

GetCito never writes the same work twice. When a new opportunity would cover the same need as one you have, because their prompts and AI searches largely overlap, it's added to that one instead and skipped. If nothing new is written, the message says so and counts any duplicates it skipped.

A question also gets only one open opportunity. When a new one would answer the same question as an open one, in the same words (years aside) or from the same group of prompts, it's added to the open one. That holds for automatic suggestions, **New**, a prompt's suggestion and a task sent from the Action Center. Its prompts, AI searches and sources join the open one, which keeps the stronger score and counts what was added. The task's History says where it went.

For a second take on the same need, use **Another angle** on the opportunity.

## How many you get

New opportunities come from a monthly allowance set by your plan, with a cap on how many one request asks for; on limited plans the page shows what's left. Skipped duplicates and opportunities that couldn't be written don't count; **Another angle** counts as one new opportunity. The up to three new opportunities GetCito writes by itself each night come from the same allowance.

## Owned and earned

Each opportunity has a **Type**. **Owned** means content on your own site. **Earned** means coverage on other sites, such as articles, reviews and links. Some gaps are best closed with a guest post or a press placement rather than a new page of your own.

Earned opportunities don't go to the Content Editor: send them to the Action Center or your workflow tool.

## Pick what to work on

Don't ship every brief. Editorial time is usually the bottleneck, so pick the two to four high-impact opportunities a week your team can really write, and leave the rest for later.
