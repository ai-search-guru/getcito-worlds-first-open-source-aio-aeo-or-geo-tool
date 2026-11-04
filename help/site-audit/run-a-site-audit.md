---
title: Run a site audit
route: /dashboard/audit
keywords: [site audit, run audit, audit a page, auto-audit, audit settings, audit again, bulk audit, audit all]
synonyms: [page audit, check my page, scan a page, AI readiness check]
plan: all
updated: 2026-11-01
last_checked: 2026-11-01
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/site-audit.mdx]
---
**Site Audit** checks how ready a page is to be cited by AI answer engines. It fetches the page, runs 48 signals in five categories, scores the page out of 100 and writes fixes for what failed. You find it in the sidebar under **Execution**, after **Content**. It is on every plan.

## Start an audit

The field at the top of the Site Audit page is filled in with your brand's primary domain. Replace it with the page you want to check and click **Run Audit**.

You can audit any page: your own, or a competitor's page to see what it does better. Audits of other sites are listed with your pages but kept out of your site's score.

## While it runs

The report opens right away and follows the audit through its stages: **Fetching the page…**, **Analyzing 48 signals…** and **Generating AI recommendations…**. An audit usually takes about 30 seconds. If it is still running after two minutes, the page says **This audit is taking longer than expected.** Click **Check again** to look again.

## Other ways to start an audit

- **Audit selected** on the **Opportunities** tab, or **Audit all** under its **Not audited** filter;
- **Re-audit** on the pages you select on the **Pages** tab;
- **Audit page** on a landing page of the **AI Referral Traffic** page, or **Audit pages** for several;
- the re-run icon at the top of a report, to audit the same page again;
- auto-audit, which audits your top-priority pages on its own.

Audits started in bulk run a few at a time.

## Before a bulk audit

Audit selected, Audit all and Re-audit ask first. They list the pages and say how many of the month's audits they use.

Pages audited in the last 7 days are left out, since a page that hasn't changed scores the same. Untick **Leave out** to include them.

When fewer audits are left than pages, the most valuable go now (on Pages, the first in the list) and the rest wait for next month.

## Auditing a page again

A page has one audit running at a time. Starting it again, from any of these places, opens the audit already running and uses no audit, however the address is written: with or without www, a last slash or a tracking parameter.

When a page was audited in the last 10 minutes, Site Audit asks first: **Open it** shows that audit, and **Audit again** starts a new one. Pages started together leave those out and say so, with **Audit again**.

## Your monthly audits

Each completed audit uses one of your plan's monthly audits. An audit still running already counts; a failed one doesn't. The **Audits this month** card shows what's left. Plans without a monthly limit show **Unlimited** on the card.

## How auto-audit works

Auto-audit spends a quarter of your monthly audits on the top pages of the **Opportunities** tab, in five runs on days 1, 7, 14, 21 and 28 of your billing month. On a plan without a monthly limit, auto-audit is off until you turn it on.

Pages you fixed go first: a page whose Site Audit fix you completed in the Action Center in the last 30 days, and that hasn't been audited since, so the action's result says whether the fix took. Pinned pages come next. Pages audited in the last 30 days wait for a later run. After a run, a notice sums it up with **View pages**, and its audits show **Auto** in the Pages list.

## Site Audit settings

**Settings**, at the top right of the Site Audit page, holds:

- **Auto-audit**: on or off for every brand in your organization. Turned off, all your monthly audits are yours to spend.
- **E-mail the team after each run**: a summary e-mail after each auto-audit run.
- **Excluded pages**: one path per line, where an asterisk stands for anything. These pages stay out of Opportunities and auto-audits.
- **Pinned pages**: the pages you pinned from Opportunities, with **Unpin**.

Only admins and managers can change auto-audit, the e-mail and excluded pages; other members see them read-only.
