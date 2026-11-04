---
title: Compare your AI visibility with competitors
route: /dashboard/competitors
keywords: [competitors, head-to-head, competitor comparison, gaps, strengths, platform breakdown, prompt-by-prompt]
synonyms: [benchmark competitors, how do we compare, competitor visibility, us versus them, competitor score]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/competitors.mdx, docs/concepts/visibility-scoring.mdx]
---
The **Competitors** page, right under **Reports** in the sidebar, compares the AI visibility of the competitors you track with yours, across your tracked prompts and AI platforms. You can also open it with **Head-to-Head** on the **Leaderboard** card of **Brand Visibility**, or by clicking a competitor's name there. **Tracked Competitors** lists them with their visibility; select one to see it head-to-head with your brand.

## Tracked Competitors

The **Tracked Competitors** card lists every competitor with its domain and:

- its AI Visibility Score from 0 to 100, the same score as on the Brand Visibility leaderboard: how often answers name it, cite its site, and how early it's named. Hover the score to see its answers, citations and position factor.
- the prompts it's visible in, out of the prompts with answers in the window, such as 12/40 prompts.

**No data** means no answer in the window was measured for that competitor yet, for example one you've just added.

The **Date Range** at the top (7d, 30d by default, 90d, All or Custom) sets the window for these scores. **Export CSV** on the card downloads your brand's and every competitor's scores, with their visible prompts, mentions and citations.

## Open a head-to-head comparison

Click a competitor's card to compare it with your brand under **Your brand vs competitor**, with both names filled in. Click the card again to close the comparison. The selected competitor is kept in the page's address, so a refresh or a shared link opens the same one.

The comparison reads every tracked answer, not just the date range. Its scores are each answer's own visibility score from 0 to 100, for your brand and for the competitor.

When there's nothing to compare yet, it says **No comparison data**: run tracking for your prompts first.

## Scores and Platform Breakdown

At the top of the comparison, **Your Avg. Score**, **Their Avg. Score** and **Score Difference** show your average score, the competitor's, and the difference between them.

**Platform Breakdown** shows your average and the competitor's on each AI platform, with the difference. A competitor can lead on one platform and trail on another, so aim your work at the platforms where it's ahead.

## Gaps and Strengths

- **Gaps** lists up to 10 prompt and platform combinations where the competitor scores higher, grouped by prompt, the widest gap first.
- **Strengths** lists up to 10 where you score higher, your biggest lead first.

A prompt with several platforms opens to show each one.

## Prompt-by-Prompt Comparison

**Prompt-by-Prompt Comparison** lists every prompt with **You**, **Them** and **Diff**, the most recently run first.

Click a prompt to see each platform, with its model and region, and how many runs it has. Click a platform with more than one run to see its **Previous runs**, with the date, both scores, the difference and the sentiment. The eye icon opens an AI answer.

**Export CSV** beside the comparison's title downloads it per prompt and platform: the model, region, runs, both scores, the difference and the latest run.

## The competitor's pages over time

Below the comparison, a card shows why the competitor may be rising. Its chart shows the answers that mentioned the competitor, and your brand, each week for the last twelve weeks. A marker sits on each week something happened to its pages; the events are listed newest first:

- **First cited in your tracked answers**: the first day an AI answer to one of your prompts cited one of its pages. When a competitor is added, GetCito reads back 90 days of your answers once, so the first date is the first within that window.
- **Changed**: once a week, GetCito reads again the 10 competitor pages your answers cited most over the last two weeks. When a page's words changed by more than a date or a price moving, it says so, with the Site Audit checks it gained or lost, such as an FAQ or a table.

## How the pages are read

The card needs the competitor's domain to find its pages. Pages are read for free from their public address, within a few reads a day, never from a site whose robots.txt keeps crawlers out. The brand's daily page reads are shared with the Action Center's tasks, which go first.

Only what Site Audit's checks found and a summary of the page's words are kept, never its text. Nothing is compared with another brand's answers.

## Close a visibility gap

1. On **Gaps**, find the prompts where the competitor leads most.
2. Open the AI answer with the eye icon: what is the competitor named or cited for? The pages-over-time card shows whether its pages changed, and **Competitor Gaps** on the **Citations** page lists the sources AI cites with the competitor and not with you.
3. Create content for that prompt in **Content**.
4. Publish it, earn placements on those sources, and watch the prompt in the comparison as new answers are tracked.
