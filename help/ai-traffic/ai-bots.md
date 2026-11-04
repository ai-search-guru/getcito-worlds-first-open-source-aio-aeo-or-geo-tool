---
title: See which AI bots read your site
route: /dashboard/traffic
keywords: [ai bots, crawlers, gptbot, claudebot, perplexitybot, cloudflare, vercel]
synonyms: [bot logs, ai crawlers, who crawls my site, bot traffic]
plan: growth
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
The **AI bots reading your site** section of **AI Traffic Analytics** shows which AI bots read your pages, from your own Cloudflare or Vercel. Only verified bots count: the bot's name and its operator's published addresses must both match. Today that's the bots of OpenAI, Anthropic and Perplexity.

## What the section shows

- **By bot type**: hits, pages read and last seen for **Training**, **Search index** and **User fetch**, with the bots under each.
- **Pages AI bots read**: hits per page, and when each type last read it.
- **The search-bot alert**: pages AI answers cited in the last 30 days that no AI search bot read in that time. It starts 30 days after the first AI-bot request, and pauses when the bot data doesn't cover the last 30 days or the month's cap was reached.

## Connect AI bots

Click **Connect** on the **AI bots** card in the Data sources strip, and choose how your site sends AI-bot requests: **Cloudflare Worker** (recommended), **Cloudflare Logpush** or **Vercel Drain** (Vercel Pro and Enterprise only). Each option says what it costs on your own Cloudflare or Vercel bill before you connect, and none of them changes your site's speed.

Click **Create connection** and follow the numbered steps. Copy the settings right away: the secret in them isn't shown again. If you lose it, revoke the connection and create a new one.

## Manage connections

**Manage** on the card lists your connections with their last request, lets you **Revoke** one, and shows this month's use. Plans in cloud mode store a monthly number of detailed rows; past it, detailed rows pause until the next month and the totals are still counted. Cloudflare Logpush and Vercel Drain also have a monthly number of log records; past it, they aren't read until the next month. Only requests to your brand's own domains, or their subdomains, are kept.

## Dates and sample data

Bot counts are kept by UTC day, so the 24-hour range reads yesterday and today (UTC), and All time reads the last 90 days.

On the Starter plan, the section shows sample data with **Upgrade**. Without a connection, it offers **Connect** or **Preview with sample data**.
