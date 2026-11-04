---
title: AI Referral Traffic page
route: /dashboard/traffic
keywords: [ai referral traffic, ai traffic analytics, ai visits, chatgpt visits, referral trend]
synonyms: [traffic from ai, visitors from chatgpt, ai referrals, ai sessions]
plan: all
updated: 2026-11-04
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
**AI Referral Traffic** in the sidebar opens the **AI Traffic Analytics** page. It measures real visits to your site from AI assistants, what those visits are worth, and whether AI is changing your Google traffic. Most analytics tools count these visits as direct or referral traffic; GetCito tells each assistant apart.

## Date range and changes

Pick a range: 24h, 7d, 30d, 90d, All or Custom. The page opens on the last 24 hours, then on the range you last picked in this browser, and every section follows it.

Each figure is compared with the period of the same length just before. Below 30 visits in either period, the change reads **Low sample** instead of a percentage. A platform or page with no visits before reads **new**. All time has no previous period.

## How visits are counted

- **One visit per session**: a reload, or a further link from the same answer, continues the visit. The visits card gives the pageviews beside the visits.
- **Snippet or Google Analytics, never both**: on days the tracking snippet sent any visit, the page counts the snippet's; on other days, Google Analytics'. The visits card says how many days came from Google Analytics.
- **Recent AI Referral Visits**, at the bottom, shows only the snippet's visits, one row per visit. Search it by address and filter by platform.
- **No snippet, no zero**: until the tracking snippet is seen on your site, the page says **Tracking code not detected** and how to add it, rather than showing 0 visits. Chat and the MCP tools say the same.

## Summary line and cards

One or two sentences above the cards sum up the range. Each fact appears only when the data can back it. The cards:

- **AI-referred visits**, with the change on the previous period;
- **Top platform** and **Platforms**;
- **AI share of traffic**, **Engaged visits** and **Key events from AI**, which need Google Analytics;
- **Google clicks**, which needs Search Console. Google reports about two days late, so 24h and 7d show its latest reported days.

## Trend and platforms

- **AI Referral Trend**: **By platform** shows visits per day, or per hour on 24h. **vs Google clicks** sets AI visits beside Google clicks; it needs Search Console and a range of 7 days or longer. On **vs Google clicks**, dashed lines mark the days actions entered the Action Center or prompts were added.
- **Platform Breakdown**: each AI platform's share of visits.
- **Referrals by Platform**: visits and change per platform, with **Engaged** and **Key events** from Google Analytics.
- **Top Landing Pages**: the pages with the most AI visits, and how often tracked answers cite them.

AI Overviews and AI Mode clicks are part of Google organic clicks, and Google doesn't let them be separated.

## Where AI visitors convert

With Google Analytics connected, two tables show what AI visits bring:

- **Top converting pages from AI**: landing pages ranked by key events from AI visits, or by revenue when the property reports it, with the best platform.
- **Which answers bring buyers**: the topics of your tracked prompts whose answers cite those converting pages, by AI platform.

A range with fewer than 30 AI visits uses the last 30 days here, and says so.

## Which AI assistants count

ChatGPT, Perplexity, Claude, Gemini, Copilot, Grok, DeepSeek, Meta AI, You.com, Phind, Poe and Google Labs. The snippet also counts Bing's Copilot answer links, as **Bing**. A visit counts when it comes from one of their sites, or from a link tagged with their name. Google Analytics' own **AI Assistant** channel also shows assistants that aren't on the list yet. AI visits that arrive with neither count as Direct. Visits from ChatGPT Shopping product cards show as **ChatGPT Shopping**; they're part of ChatGPT's visits.

## Export the page

**Export** gives the whole page as **Excel (.xlsx)**, one sheet per section, or **CSV (.zip)**, one file per section. Each table also has its own Excel and CSV buttons. A range with more than 100,000 visits is too large to export at once.

## Weekly AI Traffic e-mail

Every Monday, an e-mail about the week before goes to each brand's Daily Pulse recipients, if the brand had AI visits that week or the one before. It shows AI visits with the change, the top platform, the summary line, visits by day and platform, and the top changes.

To turn it off for a brand, untick **AI Traffic weekly digest** in **Settings › Notifications**; admins and managers can change it. It isn't sent while the brand's Daily Pulse is **Off**. The e-mail is in cloud mode only.
