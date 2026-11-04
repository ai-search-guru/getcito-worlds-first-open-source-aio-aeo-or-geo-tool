---
title: Add competitors to track
route: /dashboard/competitors
keywords: [add competitor, track competitors, suggest competitors, remove competitor, competitor domain, competitors page]
synonyms: [new competitor, follow a rival, competitor list, delete a competitor, where is the competitors page, find competitors]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/competitors.mdx, docs/guides/citations.mdx, docs/guides/add-your-first-brand.mdx]
---
Competitors are the brands GetCito compares with yours in AI answers to your tracked prompts. You add and remove them on the **Competitors** page, right under **Reports** in the sidebar, and each one then appears in **Tracked Competitors** for a head-to-head comparison.

## Open the Competitors page

Open **Competitors** from the sidebar, or from **Brand Visibility**:

- **Head-to-Head** on the **Leaderboard** card;
- a competitor's name on the Leaderboard, which opens the page with that competitor selected;
- **Head-to-Head Comparison**, shown in the Leaderboard's place before a brand has competitors.

The Action Center's **Add at least 3 competitors** step in Getting started opens it too.

Only admins and managers add, suggest and remove competitors; other members see the list and the comparison.

## Add a competitor

Click **Add Competitor** and fill in:

- **Name**: as AI answers write it, not the web address. GetCito looks for the name in every answer.
- **Domain** (optional): GetCito also looks for the domain in answers, counts citations of the competitor's pages, and marks those pages **Competitor** on the **Citations** page. The card that follows the competitor's pages over time needs it too.

Click **Add**.

## Suggest competitors

**Suggest competitors** researches your brand on the web, from its website, region and language, and lists competitors with their domains. The ones you already track are left out.

All suggestions come ticked: untick the ones you don't want and click **Add N competitors**. **Refresh suggestions** asks again. The brand needs a website first.

## Add a competitor from Citations

On the **Citations** page, the **+** button (**Add as competitor**) on a cited domain that isn't yours or a tracked competitor's opens a dialog with a name taken from the domain. Edit the name and click **Add**. A cited URL's own page has **Add as competitor** too, which adds its domain.

## When a new competitor is counted

A competitor is counted in the answers tracked after you add it; earlier answers aren't counted again. Until an answer in the date range is measured for it, its card says **No data**.

When a competitor is added, GetCito also reads back 90 days of your answers once, to find the first time AI cited one of its pages.

## How many to track

The Getting started step asks for at least 3 competitors, and 5 to 20 give the clearest picture.

AI answers to your prompts may name brands you've never heard of. They are the alternatives people see when you're not cited. Add the most-mentioned ones to your competitors to track them properly.

## Remove a competitor

Hover the competitor's card in **Tracked Competitors**, click the bin icon, then **Yes, remove competitor**. It's no longer tracked. Past results keep their numbers, but they can't be linked back to the competitor.

## When the workspace is read-only

In cloud mode, while the workspace is read-only, **Add Competitor**, **Suggest competitors** and removing a competitor open the plan dialog instead.
