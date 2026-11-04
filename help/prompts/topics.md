---
title: Topics tab for prompts grouped by theme
route: /dashboard/prompts/topics
keywords: [topics, topic, add topic, delete topic, rename topic, manage topics, topic suggestions, topic leaderboard, topic visibility, top competitor]
synonyms: [themes, prompt groups, clusters, categories]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/topics.mdx, docs/guides/prompts.mdx, docs/guides/add-your-first-brand.mdx]
---
**Topics** is a tab of the **Prompts** page. It groups your tracked prompts by theme, so you can see how your brand does in AI answers at a higher level than single prompts.

The tab uses the page's date range (24h, 7d, 30d, 90d or custom) and opens on the last 24 hours. It has no Location selector, because topics aren't split by location.

## The cards at the top

Four cards sum up your topics:

- **Tracked topics**: how many topics you have, and how many prompts have no topic yet.
- **Best performer**: the topic with the highest Visibility score.
- **Biggest gap**: the topic with the lowest score, among those above 0.
- **Top mover**: the topic whose score rose most, in points; when every topic fell, the one that fell least.

## The Topic leaderboard

The **Topic leaderboard** has a row per topic:

- the topic's name and how many prompts it has;
- **Visibility**: the 0 to 100 score over the topic's answers, the same score as on **Brand Visibility**;
- **SoV**, **Mentions** and **Citations**;
- **Trend**: a small line and the change in points against the window of the same length just before;
- **Top competitor**: the competitor with the largest share of voice in the topic;
- **Last run**.

Click **Prompts**, **Visibility**, **SoV**, **Mentions**, **Citations** or **Last run** to sort by it; the table opens sorted by Visibility. Click a topic to open its page.

## The buttons beside the tabs

- **Add Topic** creates a new, empty topic.
- **Export CSV** downloads the leaderboard as a CSV file.
- **Manage topics** opens the brand's topic settings.

## A topic's page

A topic's page shows all of its results, not only the date range picked on the Topics tab:

- **Visibility**, **Brand mentions**, **Citations** and **Positive sentiment** for the topic;
- **Visibility trend**: your daily visibility on the topic against the competitor average;
- **Share of voice by platform**: you against competitors on each answer engine;
- **Competitor comparison**: the top six brands on this topic, ranked by their score, with yours marked **YOU**;
- **Prompt performance**: the topic's **Top performers** and the prompts under **Needs improvement**, from its last 50 runs.

**View all prompt results for this topic** opens **Brand Visibility** filtered to the topic.

## Topic Suggestions

The **Topic Suggestions** card on the Topics tab starts folded, and remembers whether you left it open. Open it to see AI-generated topic ideas for your brand. Topics you already track and ideas you dismissed don't come back.

Admins and managers can **Refresh** for new ideas, add an idea to your topics, or dismiss it. A new topic starts empty: assign prompts to it to start tracking it.

## Add and rename topics

Only admins and managers can change topics; other roles can view them.

- **Add Topic** creates a new, empty topic.
- To rename a topic, click **Manage topics** and use the pencil icon beside it in the brand's topic settings. Its prompts stay attached.

Keep topic names short (two to four words) and intent-driven: "Pricing" works better than a long descriptive phrase.

## Delete a topic

Admins and managers open the **…** menu at the end of a topic's row and choose **Delete topic**. The dialog says how many prompts are in the topic.

The prompts aren't deleted: they keep their tracking and results, and move to prompts without a topic. After you confirm, **Undo** puts the topic back for 10 seconds.

## Use topics for planning

- **Editorial planning**: pick the topic with the lowest score and the weakest competitor lead; it's a good candidate for your next content sprint.
- **Reporting**: topic-level stories, such as which themes you own and which you're losing, are easier to share than prompt-level metrics.
- **Spotting drift**: a topic that drops while others stay flat usually signals one competitor's surge or content that has aged.
