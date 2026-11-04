---
title: Brand Visibility page overview
route: /dashboard/insights
keywords: [brand visibility, answer engine insights, visibility score, key metrics, leaderboard, by AI platform, topics vs competitors, opportunities, filters]
synonyms: [AI visibility report, analytics hub, insights page, dashboard overview, visibility dashboard]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/answer-engine-insights.mdx, docs/guides/competitors.mdx, docs/guides/prompts.mdx]
---
**Brand Visibility** in the sidebar opens **Answer Engine Insights**, the main analytics page for a brand. It's your daily view of how AI answers treat your brand across your tracked prompts, and where to act next.

## The header

The header shows the brand's name, when the last run finished and when the next one is due. It has these buttons:

- **Formulas** explains how every number on the page is calculated.
- **Export CSV** downloads the answers behind the page, with the current filters.
- **Reports** opens the Reports page.

A self-hosted instance also has **Test Single Prompt** and **Run All**, to start a run by hand.

## The summary line

Below the filters, one line sums up your Visibility score and its change, your rank and the gap to the brand next to you, and the platforms that moved most. The copy button puts the line on your clipboard, ready to paste into a message or a report.

## The key metric cards

Nine cards follow. Most show their change **vs previous period** and a small daily line:

- **Visibility**: your score from 0 to 100, and your rank among the tracked brands, or, before you track competitors, how many prompts you appeared in. Click it to open the **Visibility Breakdown** panel.
- **Tracked prompts**: the prompts answered in the period. On plans with a limit, a bar shows how many prompt locations your workspace uses. Click it to open Prompts.
- **Mentions** and **Citations**: how often answers named your brand and cited your pages. They open the Mentions and Citations pages.
- **Net sentiment**: the positive minus the negative share of the answers that name you. It opens Mentions.
- **Coverage**, **Share of voice**, **Avg. position** and **Citation rate**.

A rate based on fewer than 20 answers says **Low sample** and shows no change.

## Visibility trend

The trend and the Leaderboard are shown once you track competitors; until then, a card links you to adding them.

The trend draws your Visibility over the date range next to your competitors' lines. Admins and managers can **Pin** up to 5 competitors to keep on the chart; without pins, the strongest four are shown. Outside the 24-hour view, the chart also marks the days prompts were added and your Action Center goal for AI visibility, if one is set.

## Leaderboard

The **Leaderboard** ranks you against your competitors, with each brand's score, change, Coverage and share of voice. Under your row it shows the gap to the brand ahead and the platform where that brand leads you most.

**Head-to-Head** opens the **Competitors** page. A competitor's name opens it with that competitor selected. Before a brand has competitors, **Head-to-Head Comparison** appears in the Leaderboard's place and opens the same page.

## By AI platform

**By AI platform** is a table with each platform's **Visibility**, **Change**, **Coverage**, **Share of voice** and **Avg. pos**. The row with the biggest drop is highlighted.

A platform with too few answers shows **Low sample** or **No runs this period** instead of numbers. Use the table to send your content work toward your weakest platform.

## Why it changed

**Why it changed** lists the platforms, topics and prompts that moved your Visibility most, under **Gains** and **Drops**. Each row shows its own score before and after, and its effect on your overall score. A note counts the prompts added during the period, which aren't counted in the change.

Click a row, or **Full breakdown**, to open the **Visibility Breakdown** panel.

## Topics vs competitors

**Topics vs competitors** has one row per topic, with your score and the score of each competitor on the trend, shaded from low to high. The last column shows the gap to the topic's leader, or **Lead** when you lead. Click a topic to open its page.

## Opportunities

**Opportunities** shows what to track next, from your prompt suggestions:

- A topic has **Track N**, which tracks all its suggested prompts, and **Send action**, which opens a Growth action in the Action Center.
- A prompt has **Track**, and **Suggest content**, which writes a content suggestion for its topic from your monthly content allowance.

Tracking stops when your plan's prompt locations are full. **Track**, **Track N** and **Suggest content** are for admins and managers. **See all** opens **Prompt Suggestions** under **Prompts**.

## Volumes on Opportunities

The volumes shown with these suggestions are an AI's guess, since no keyword behind them is measured yet. They are always low confidence: grey, from half to twice the guess. Track a prompt to get an estimate from its keywords' Google searches.

## Filters and date range

Under the header:

- **Date Range**: **24h** (the default, the latest completed run), **7d**, **30d**, **90d**, **All** or **Custom**.
- **Topic**: one topic, shown when the brand has topics.
- **Region**: one region your prompts run in.
- **AI Model**: one AI platform; versions of the same engine count as one.

The filters apply to everything on the page except **Opportunities**, which lists your stored suggestions. They're kept in the page's address, so a link you share opens with the same filters.

## A weekly review

1. Set the range to **7d**. Is your Visibility up or down? If it's down, **Why it changed** shows which platforms, topics and prompts moved it.
2. In **By AI platform**, find the platform with the lowest score or the highlighted biggest drop: that's your next investment.
3. Look at the suggested topics and prompts in **Opportunities**, and track one to three of them.
4. From **Opportunities** under **Content** in the sidebar, open the opportunity for the topic that did worst this week and click **Generate Brief**.
