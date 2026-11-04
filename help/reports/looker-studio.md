---
title: Connect Looker Studio
route: /dashboard/settings/api-keys
keywords: [Looker Studio, connector, GA4, blend data, metric sets]
synonyms: [Google Data Studio, visibility in my own dashboard, connect a BI tool, reporting dashboard]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/looker-studio.mdx]
---
The GetCito connector for Looker Studio pulls your AI visibility metrics into Looker Studio. One dashboard can then show AI visibility next to organic traffic, such as GA4 sessions and Search Console clicks, on one date axis. Ask the person who runs your deployment for its connector link.

## Connect

1. In **Settings › MCP & API Keys**, click **New key**, give it a name and click **Create**. Copy the key now: it is shown only once.
2. Open the connector's link. Looker Studio asks you to authorize the connector, then asks for a key: paste the one you copied.
3. Pick the brand and a metric set, then click **Connect** and **Add to report**.

## Metric sets

Each data source gives one metric set; add several data sources to use more than one in a report.

- **Visibility Trend (daily)**: by date, the average visibility score, mentions, citations, tracked results and the competitor average.
- **Share of Voice by Platform**: by platform, brand mentions, competitor mentions and share of voice.
- **Citations — Top Domains**: by domain and category, citations, results citing and usage.
- **AI Traffic by Platform**: visits by platform.

The report's date range control sets the dates for every chart; no data source needs its own dates.

## Blend with GA4

Visibility Trend is built for blending: join it to a GA4 source on the **Date** dimension, and plot the average visibility score against sessions on a dual-axis time series. A rising visibility line that comes before a traffic lift is the clearest way to show AI search's impact to a client.

## Good to know

- Results are kept for five minutes per user, so a dashboard with many charts doesn't ask GetCito again for each one.
- A key belongs to its creator's organization: only that organization's brands appear in the brand picker.
- Revoking the key in **Settings › MCP & API Keys** breaks the data source at once, and Looker Studio asks for a new key.
- Your deployment needs its own copy of the connector, configured to read its web app.
