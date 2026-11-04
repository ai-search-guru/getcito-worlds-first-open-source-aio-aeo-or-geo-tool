---
title: Find where competitors are cited and you aren't
route: /dashboard/citations
keywords: [competitor gaps, gap list, by competitor, outreach targets, strength, third-party sources]
synonyms: [sources citing competitors, citation gaps, where competitors get cited, outreach list, sites that skip us]
plan: all
updated: 2026-10-29
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/citations.mdx, docs/guides/competitors.mdx]
---
**Competitor Gaps** is a tab of the **Top Sources** card on the **Citations** page. It lists the third-party domains that AI engines cite when they name a competitor and not you. These are outreach targets: sites AI engines already trust for your prompts, where a mention or a citation of your own is missing.

## Gap list

The **Gap list** view shows domains cited in at least two answers that name a competitor while your brand isn't named and none of your domains is cited, and never cited in an answer where you appear. It lists up to 100 domains, strongest first, with these columns:

- **Domain**;
- **Source type**;
- **Competitor answers**: how many of those answers cite it;
- **Which competitors**: the competitors those answers name;
- **Strength**.

## By competitor

**By competitor** shows one competitor at a time: pick it from the list to see the third-party domains cited in the answers that name it, with these columns:

- **Domain** and **Source type**;
- **Answers feeding**: how many answers that name the competitor cite the domain;
- **Also cites us?**: whether the domain also appears in an answer where you appear;
- **Strength**.

## How Strength works

**Strength** weighs each answer by how many sources it had, so a source in a two-source answer counts more than one in a twenty-source answer. Hover **How this works** beside the views for a short note on the method.

When your brand appears in fewer than one answer in ten in the window, a note says the list may be broad. Work on your baseline visibility first.

## Filters and export

Competitor Gaps follows the page's date, topic, prompt, platform and region filters. It doesn't follow the **Brand**, **Competitors**, **Third-Party** or **All** choice above the Domains and URLs tables.

**Export CSV** in the page header, with this tab open, downloads the gap list: each domain with its source type, competitor answers, competitors and strength.

## Close a gap with these sources

1. On the **Competitors** page, find the prompts where a competitor leads you, under **Gaps**.
2. Here, in **By competitor**, see the sources AI cites with that competitor and not with you.
3. Create content for the prompt in **Content**.
4. Publish it, earn placements on those sources, and watch the prompt in the head-to-head comparison as new answers are tracked.
