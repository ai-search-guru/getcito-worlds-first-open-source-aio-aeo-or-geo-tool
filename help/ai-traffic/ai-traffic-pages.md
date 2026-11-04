---
title: AI traffic by page and Google query
route: /dashboard/traffic
keywords: [no ai traffic, cited not clicked, broken ai links, untracked google queries, pages]
synonyms: [pages without ai visits, 404 from ai, redirect suggestions, ai taking google clicks]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/ai-traffic-analytics.mdx]
---
The **Pages** section of **AI Traffic Analytics** answers which pages get AI visits, which don't, and why. Below it, the Google Search Console tables show whether AI is changing your Google traffic.

## The Pages tabs

- **No AI traffic**: pages with traffic in Google Analytics or in your sitemap that got no AI visit, most valuable first. **AI visibility** says why: **Cited**, **Not cited** or **No prompt**.
- **Cited, not clicked**: pages AI answers cited at least 20 times in the range that got no AI visit.
- **Traffic, no prompt**: pages AI assistants sent visitors to that no tracked prompt's answer cited.
- **Broken AI links**: pages AI visitors landed on that don't exist.
- **All pages**: every page with AI visits, citations, traffic or a sitemap entry in the range.

## Next steps from a page

Rows carry their next step: **Audit page** for a page AI cites or a prompt targets, **Add prompts** for one no prompt points to.

On **No AI traffic** and **Cited, not clicked**, each row's **…** menu also has **Send to Action Center**, **Add prompts** and **Suggest content**. Under the list, **Audit N cited pages** (or **Audit N pages**) starts Site Audits for the pages shown, and **Send to Action Center** sends them as one action. Only admins and managers can add prompts or suggest content.

## Add prompts for a page

**Add prompts** suggests questions people ask AI assistants that the page answers, including ones from its Search Console queries, and lets you add your own. The prompts you track from it point to the page, so their answers show whether AI cites it. Each one uses a prompt slot on your plan.

## Fix broken AI links

**Broken AI links** shows what the visitor got: **Not found (404)**, **Gone (410)**, **Shows a not-found page (200)** for a site that shows its own not-found page, or **Page title says not found** where the browser reports no status.

Each comes with a suggested **Redirect to**: a **Similar page**, **The page above it** or the **Home page**. Addresses with a query string get no suggestion. With the tab open, the Excel and CSV buttons export the redirect list. Add the tracking snippet to your 404 page too, so these visits are seen.

## Is AI taking Google clicks?

With Search Console connected, **Is AI taking Google clicks?** lists pages whose impressions rose 15% or more while their click-through rate fell 20% or more, among pages with at least 100 impressions in the period before. An AI Overview may be answering in place of the click. **Positions** shows whether you're cited for a tracked prompt about the page; **Add prompts** appears when none is about it yet.

## Untracked Google queries

**Untracked Google queries** lists Search Console queries with clicks that no tracked prompt covers, most clicked first. **Track** adds one as a prompt; **Track all** adds the listed ones that your plan's prompt slots allow. Admins and managers can track queries.
