---
title: Query Fan-outs behind AI answers
route: /dashboard/prompts/fan-outs
keywords: [query fan-out, fan-outs, searches behind answers, copilot, perplexity, by prompt, high frequency, times searched, track a sub-query]
synonyms: [sub-queries, background searches, AI search queries, what the AI searched, not shared]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/prompts.mdx]
---
Behind an answer, an AI engine can run searches of its own. The **Query Fan-out** tab of the **Prompts** page lists the searches the AI engines ran behind their answers to your tracked prompts. In the sidebar, the **Prompts** item opens it as **Query Fan-outs**.

## Which engines share their searches

Copilot and Perplexity share the searches behind their answers. ChatGPT's are sampled on some days, and the ChatGPT API shares them when it searches. Google AI Overviews, AI Mode, Gemini and the Claude and Gemini API models don't share them: their chips say **not shared**, and a note under the chips names them.

## Engines

Above the list, **All engines** counts the searches found in the range, and each engine that answered has a chip of its own. A chip gives the share of that engine's answers that came with searches, such as "40% of answers", and how many searches it ran. Click a chip to see only that engine's searches; click it again, or **All engines**, to see them all.

An engine that usually shares its searches but sent none is marked in amber, "none since" a date, with a note under the chips. Its answers are still tracked as usual; only the list of searches is missing. A **not shared** chip is faded and doesn't filter.

## By prompt

**By prompt**, the view the tab opens on, lists your tracked prompts with answers in the range. Each row shows:

- the engines that answered it, coloured when they shared searches for it and faded when they didn't;
- **Answers with fan-out**: how many of its answers ran a search at all;
- **Sub-queries**: how many searches they ran.

Expand a prompt to see its searches, each with its **Engine**, **Times searched** and **Intent**.

## High frequency

**High frequency** lists every search behind your prompts' answers, the most searched first:

- **Sub-query**: the search the engine ran;
- **Engine**: the engines that ran it;
- **Times searched**: how often it ran in the range;
- **Sourced prompts**: the tracked prompts whose answers ran it;
- **Intent**: the kind of search, such as How-to, Comparison or Best / Top.

Both views have a search box to narrow the list.

## Track a search as a prompt

Admins and managers can click **+** on a search to track it as a prompt of its own and measure your visibility on it. The row then reads **Tracked**, which opens the new prompt. A brand without topics is asked to add one first.

## Pick the date range

The tab uses the **Prompts** page's date range: 24h, 7d, 30d, 90d or custom. It opens on 7d, because one day of answers holds few searches; a range you picked on another tab carries over. The tab has no **Location** filter: it shows the searches from every location you track.
