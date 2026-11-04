---
title: Citations page
route: /dashboard/citations
keywords: [citations, cited sources, cited URLs, source types, domains, top sources, export citations, third-party sources]
synonyms: [which sites AI cites, AI sources, links in AI answers, references in AI answers, cited pages]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/citations.mdx]
---
The **Citations** page lists the domains and URLs that AI engines cited in their answers to your tracked prompts, for the brand selected in the sidebar. It shows which sources AI engines rely on when they answer questions in your category, and sorts them by source type. It reads the answers your tracking already collects.

## Filters

- **Date Range**: 24h (the default), 7d, 30d, 90d, All or Custom.
- **Topic**: one topic. It's shown only when the brand has topics.
- **Prompt**: one tracked prompt; type to search the list.
- **Platform**: one AI platform, or all of them.
- **Region**: one region the answers were tracked in, or all of them.

The filters are kept in the page's address, so a refresh or a shared link opens the same view. When a table is empty for the window but the brand has citations outside it, **Show all data** clears the filters and shows all dates and all sources.

## Summary cards

Three cards sit at the top of the page:

- **Total Citations**: every citation in the window, across the tracked results (AI answers) in it.
- **Unique Domains**: the cited domains in the source choice you made (**Brand**, **Competitors**, **Third-Party** or **All**), with their unique URLs.
- **Avg citations per result**: the number of links per AI answer.

## Top Sources and the source choice

The **Top Sources** card has four tabs: **Domains**, **URLs**, **Competitor Gaps** and **Source Types**.

Above the Domains and URLs tables, four buttons choose which sources they list:

- **Brand** (the default): your brand's own domains.
- **Competitors**: the domains of the competitors you track.
- **Third-Party**: every other site.
- **All**: every source.

The choice doesn't change **Total Citations**, **Avg citations per result**, **Competitor Gaps** or **Source Types**.

## The Domains tab

The **Domains** tab ranks each cited domain by how often it was cited, with these columns:

- **Domain**: the domain, its source type, and a link that opens the site.
- **Platforms**: the AI platforms whose answers cited it.
- **Usage**: the share of tracked answers in the window that cite it.
- **Avg Citations**: how many times an answer that cites the domain cites it, on average.

On a domain that isn't yours or a tracked competitor's, the **+** button (**Add as competitor**) opens a dialog with a name taken from the domain. Edit the name and click **Add** to track it on the **Competitors** page.

## The URLs tab

The **URLs** tab ranks each cited page by its citations, with **Platforms**, **Usage** and **Citations**. Click a page's title to open its own page in GetCito, with every answer that cited it; the small icon beside the title opens the page itself.

The tab lists up to the 2,000 most-cited URLs, and its count gives the full number. Both the Domains and URLs tables show 100 rows a page.

## Export CSV

**Export CSV** in the page header downloads the open tab, with the filters applied:

- **Domains**: each domain with its source type, citations, the answers citing it, its usage and the AI platforms.
- **URLs**: each page with its domain, source type, title, citations, the answers citing it and its usage.
- **Competitor Gaps**: the gap list, with each domain's source type, competitor answers, competitors and strength.

**Source Types** has no export.

## Source types

GetCito gives every cited domain one of eight types:

- **You**: your brand's domains and their subdomains.
- **Competitor**: the domains of the competitors you track, and their subdomains.
- **Editorial**: a fixed list of well-known news, tech and magazine sites.
- **Forum**: forums and question-and-answer sites.
- **Social**: social networks, video sites and blogging platforms.
- **Review**: review and rating sites.
- **Institutional**: .edu, .gov and .mil addresses (country versions included), academic addresses such as .ac.uk, Wikipedia, and a list of public and international bodies.
- **Other**: every site that isn't on one of the lists.

You and Competitor come first: a tracked competitor's domain is always Competitor, even when it's also a review site. Only competitors with a domain are matched. The other lists are short, so most sites are Other.

## The Source Types tab

The **Source Types** tab shows the cited domains in a donut chart, with each type's share of the domains, not of the citations. It covers every cited domain in the window, whatever the source choice above the tables.

## How to use the page

- **See which of your pages AI cites**: keep **Brand**, the default, and open the **URLs** tab. It lists your own pages that AI cites, on which platforms and how often. Open a page to see the prompts it's cited for.
- **Find the third-party sources AI trusts**: choose **Third-Party**. The top of the Domains and URLs lists are the sites AI leans on most for your prompts: places to be mentioned or cited.
- **Watch your competitors' pages**: choose **Competitors** to see which competitor domains and pages AI cites in your answers.
- **Find outreach targets**: the **Competitor Gaps** tab lists the third-party sites AI cites when it names a competitor and not you.
