---
title: Mentions & Sentiment page
route: /dashboard/mentions
keywords: [mentions, sentiment, brand mentions, mention rate, net sentiment, co-mentioned]
synonyms: [where AI names my brand, tone of AI answers, brand mentions in AI answers, how AI talks about us]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/mentions.mdx]
---
The **Mentions & Sentiment** page, **Mentions** in the sidebar, shows where AI answers name your brand, in what tone, and next to which competitors. It reads the answers your tracking already stores, so opening it or changing a filter never asks an AI model again. It has three tabs: **Overview**, **Mentions** and **Perception**.

## Filters

All three tabs share one filter bar, for the brand active in the sidebar. **Date range** offers 24h, 7d, 30d (the default), 90d or Custom; a custom range is read as whole UTC days. **Platform** picks one AI platform or all of them. **Country** appears only when the brand tracks more than one country, and **Topic** only when it has topics. **Search** matches the prompts' text, also on the Perception tab, where the box reads *Search keywords…*. The tab and the filters are kept in the page's address, so a refresh or a shared link opens the same view.

## Overview tab

The **Overview** opens with a summary line: net sentiment and its change, the platform behind most of that change, and the competitors AI usually names next to you. Four cards follow: **Total mentions**, **Mention rate**, **Prompts with mentions**, and **Net sentiment** with its positive, neutral and negative split. **Mentions & sentiment over time** draws one point per day; the 24h view has no trend. **By AI platform** compares the platforms and notes when two platforms' net sentiment is 40 or more points apart. **Competitor framing** shows how often AI names each competitor and, under **Also names you**, how many of those answers name you too.

## Changes from the previous period

Every change compares the selected period with the period of the same length just before it. It is taken only on the prompts that were answered in both periods, so adding or pausing prompts doesn't show up as a rise or a fall.

## Mentions tab

The **Mentions** tab lists every answer that names your brand, 100 per page. Each row shows the prompt, the platform, the country when the brand tracks more than one, the **Mention context** around your brand, the **Sentiment**, the **Position** (#2 of 5 means named second of five brands), the **Co-mentioned** competitors, the topic and the date. The table's own controls filter by **Sentiment** and **Co-mentioned**, **Group by** prompt or platform, and **Sort** by Newest, Oldest, Most co-mentions or Most negative. Click a row to open the full answer in a side panel.

## Copy summary and Export CSV

The page header has three buttons. **Copy summary** copies the Overview as plain text: the filters, the summary line, the four figures and the period, ready to paste into a doc or a ticket. **Export CSV** downloads the answers that name your brand under the filters, one row per answer, up to 5,000 rows per file. From the Mentions tab, the file also follows the table's sentiment and co-mention filters and its sort. Lines above the rows record the filters, the period and the counts. **Reports** opens the Reports page.
