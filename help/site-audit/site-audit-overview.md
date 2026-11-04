---
title: Site Audit scores, opportunities and pages
route: /dashboard/audit
keywords: [site score, pages audited, audit opportunities, audited pages, score over time, first score, current score, not audited, audit coverage]
synonyms: [audit overview, audit history, which pages to audit, audit priority]
plan: all
updated: 2026-11-01
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/site-audit.mdx]
---
The **Site Audit** page sums up your audits: a summary line, four cards and a chart, then two tabs. **Opportunities** lists the pages worth auditing next, and **Pages** lists every page you audited.

## Summary and cards

A summary line gives your site score, pages audited, lowest category and next auto-audit. The first three cards count only the pages of your primary domain:

- **Site score**: the average score of each page's latest audit, and its change from each page's previous audit.
- **Pages audited**: how many of your site's pages, as your sitemap, Google Analytics and AI citations list them, have an audit from the last 90 days, and how many don't. **See the … not audited** opens those in Opportunities.
- **Authority · E-E-A-T**: those two category scores averaged over your pages, and the signals that fail or warn on the most pages.
- **Audits this month**: audits left this billing month, with the share auto-audit keeps for its next runs.

## Score over time

**Score over time** charts your primary domain's audit scores, one point a day from the latest audit that day, over 7d, 30d, 90d or All. The category breakdown of the latest audit sits beside it. The chart needs audits on at least two days.

With the Content Editor's Quality on, a **Site trust** card, out of 5, reads your site's trust pages. It counts toward Quality's Trust, not the audit score.

## Why a page is in Opportunities

The **Opportunities** tab is an inbox of pages worth auditing next. Each row shows a **Priority** from 0 to 100, the page, **Why** it's listed, its **AI visits** over the last 30 days and its **Last audit**. A page is listed when:

- **No AI traffic**: it ranks high on your site in Google Analytics but gets no visitors from AI engines. **Targeted, not cited** adds that a tracked prompt points at it and no AI answer cites it;
- a competitor is cited on prompts where you never are, and this is your closest page;
- it was **Never audited**, or not in the last 90 days.

AI visits need Google Analytics or the tracking snippet.

Chips above the list show one reason at a time: **All**, **Not audited**, **No AI traffic** or **Competitor cited**, each with its count.

## Priority and templates

The priority multiplies the page's value to the business, the size of the opportunity and how easy it is to fix, meaning how close its last score is to passing. Hover the number to see the three parts.

Pages built from one template, such as every post of a blog, share most of their gaps. When at least two-thirds of a template's audited pages fail or warn on the same signals, the template gets one row: **Fix once, applies to** its pages. Auditing it audits the template's pages that have no audit yet.

## Select, pin or exclude

Select rows to **Audit selected**, to **Pin** them, so they always come first, or to **Exclude** them. Excluded pages are listed under the table, where **Restore** puts them back.

Pins and exclusions hold for the whole brand, so only admins and managers see **Pin**, **Exclude** and **Restore**.

## The Pages tab

**Pages** lists every page you audited, one row per page, most recent first, with its **First score**, **Current score**, **Issues** (signals that failed or warned), **Status** and **Last audit**. Once a page has two audits, the change since the first shows beside the current score: green up, red down. Status is **Good** (70 or more), **Improving** (below 70 but up from the previous audit), **Needs work**, **Running** or **Failed**. **Auto** marks an auto-audit's audit.

Click a row to open its latest report. The arrow beside a page lists its earlier audits, each with **View report** and a delete icon. **Group by template** groups the rows under their template. **Export** downloads the list as CSV or Excel, first scores included; select pages to **Re-audit** them or export only those.
