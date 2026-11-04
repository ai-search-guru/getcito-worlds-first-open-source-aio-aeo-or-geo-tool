---
title: Act on mentions with the Action Center and content
route: /dashboard/mentions
keywords: [send to action center, suggest content, act on mentions, negative mentions]
synonyms: [improve how AI describes us, fix negative answers, turn mentions into tasks, create action from mentions]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/mentions.mdx]
---
From the **Mentions** tab of the Mentions & Sentiment page, you can turn answers that name your brand into work: one Action Center action for a set of answers, or a content suggestion for an answer's prompt.

## Send answers to the Action Center

Tick the rows you want; the box in the table header selects every answer on the page. A bar appears with **Send to Action Center**, **Export** for a file of just the selected rows, and **Clear**. You can also send a single answer from its side panel. One send takes up to 100 answers, a full page. Sending the same answers again while their action is still open doesn't create a second one: the notification says **Already in the Action Center** and opens the existing one.

## What the action contains

The selected answers become one action, titled *Improve how AI describes you for "…"*, or *across N prompts* when they cover several. It quotes up to 10 of the answers with their platform, sentiment and excerpt. It is a **Protect** action when any of the answers is negative, and a **Growth** action otherwise; the larger the share of negative answers, the higher its impact. Its tasks walk you from inspecting the contexts you're mentioned in and analyzing the cited sources to strengthening how your brand is described, publishing, and measuring the outcome on the answers' prompts.

## Suggest content

**Suggest content** in an answer's side panel writes a content suggestion for the answer's prompt. When it is ready, the notification opens it in Content. If the prompt already has a suggestion, **Open existing** takes you there instead. Suggestions count toward your monthly content limit. Only admins and managers see **Suggest content**. A prompt can't get a suggestion until it has tracked answers and a prompt group; both arrive with its next tracking run.
