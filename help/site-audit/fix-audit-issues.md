---
title: Fix site audit issues
route: /dashboard/audit
keywords: [ai recommendations, fix audit issues, placeholders, your input needed, send to action center, re-audit]
synonyms: [audit fixes, improve audit score, fix failed signals, raise page score]
plan: all
updated: 2026-10-31
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/site-audit.mdx]
---
An audit report doesn't only score a page: it writes fixes for what failed. Start with the **AI Recommendations**, then open the failing signals. When you've made your changes, click the re-run icon at the top of the report to audit the page again.

## AI Recommendations

**AI Recommendations**, right under the score, collects the fixes written for this page, ordered by priority: **high**, **medium** or **low**. Each names the signal and says what to change in one sentence. Where it helps, it gives a ready-to-paste draft, such as a meta description, an H1, an opening paragraph, FAQ questions and answers or sources to cite, and code, such as an FAQ schema block.

Mechanical signals, such as HTTPS, the viewport tag, alt text or a video embed, keep their general fix.

## Your input needed

Recommendations only use facts found on the page, or your brand's name, description and domains when the page is on one of your domains. A number, percentage or date found in neither, such as a statistic, is left out with its sentence, so there is nothing for you to research.

Only what your brand alone knows is left in square brackets for you, three at most in a recommendation: a customer's name, your price, your own result, such as [customer name], [price] or [your result]. Each is highlighted, marked **Your input needed**. Replace each one before you publish. Search the pasted text for an opening bracket first: a placeholder left in schema code tells AI engines nothing.

## Copy drafts and code

Each draft and code block has a copy icon in its corner. It copies the block exactly as shown, placeholders included, and a **Copied** message confirms it.

## Send a page to the Action Center

On a page that fails checks, **Send to Action Center** sends the page and the checks it fails as one Fix action, without waiting for the nightly pass. Sent again while that action is open, it doesn't add another: a notice names the open action, with **Open**. Only a page's latest report can be sent; an older one offers **Open the latest report**.

Once you complete the action, it is judged by the page's next audit: the checks it failed now passing.

## How audits feed the Action Center

Each night the Action Center reads each page's latest audit from the last 90 days and turns failed signals into actions:

- **Fix low-scoring pages**, for audited pages scoring below 50;
- **Fix AI crawler accessibility**, **Fix structured data issues** and **Fix outdated content**;
- **Fix weak entity signals**, **Fix internal content connectivity** and **Fix content gaps**.

An action lists the pages it covers and the failed checks on each, with **Open Site Audit**.

## Re-audit after you fix

Only each page's latest audit counts. Once a new audit no longer fails a check, the Action Center stops reporting that page; an audit older than 90 days no longer counts either. Auto-audit also re-audits, in its next run, the pages whose Site Audit fix you completed in the Action Center.
