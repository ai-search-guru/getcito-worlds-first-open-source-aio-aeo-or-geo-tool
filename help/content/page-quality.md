---
title: Check a page's Quality in the Content Editor
route: /dashboard/content/editor
keywords: [quality score, e-e-a-t, trust, readability, hand off, next step, before you publish, page author, qualified reviewer, reviewer, reviewed by, trusted sources]
synonyms: [content quality, quality check, page score, eeat score, ready to publish checklist, content reviewer, regulated page review]
plan: all
updated: 2026-11-04
last_checked: 2026-11-03
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
Quality scores a Content Editor page and lists what would raise it. It's turned on per installation: where it's off, nothing on this page shows. With it on, **Instructions** in the side panel has a third segment, **Quality**, and the header a **Quality** chip with the page's score.

## The scores

Quality scores the page from 0 to 100 on three things, each card saying what it scores:

- **E-E-A-T**: who stands behind the page, such as its author and their experience.
- **Trust**: sources, links and dated facts.
- **Readability**: how easily it reads.

80 and up is **Strong**, 60 to 79 **Can improve**, and under 60 **Needs work**. The header's **Quality** chip is the average of the three. The scores are GetCito's estimates from Google's published quality signals, not a Google score.

Under them, **Site Audit estimate** is about where the page would score in Site Audit. See the Content Editor article.

At the bottom, **Site trust**, out of 5, comes from Site Audit's checks of your site, with **Fix in Site Audit** when some are missing.

## Your to-dos and what would raise it

- **Your to-dos** are what only you can do, such as picking the page's author, adding your own experience, data or an expert's quote, linking the proof for a claim, and filling the placeholders.
- **What would raise it** lists the checks still open, each with about how many points it could add to a score (an estimate, not a promise) and, where it has one, a button such as **Show** or **Add source**.

## Hand off

**Hand off** asks the Content Agent to fix the open suggestions in one run, as changes for you to review. Your to-dos stay yours. Each Hand off is kept in the page's History, and it uses your workspace's monthly AI usage.

In **Settings › Content**, admins and managers can have each brand's new pages handed off on their own when they're first opened in the editor.

## Trusted sources

**Trust** counts links to official and research sites as primary sources. In **Settings › Content**, admins and managers can add the sites a brand trusts besides, such as its industry's association or the docs it cites, one per line, up to 50. Links to them, and to their pages, count as primary sources here and as authority links in Site Audit.

## Next step

With Quality on, the header's **Next step** opens a window: every step on the left; on the right, the one to take, who takes it, what raises the score and one button, with **Skip this step**. A step the Content Agent takes says about how long it runs and its share of your AI usage. While its suggestions wait, the step is **Review**; with nothing to build the brief from, **Add sources**.

Once you've decided the agent's **Fix open rules** suggestions, the step is ticked. Rules its later suggestions leave open don't bring it back; your edits can.

**Show to-dos** scrolls Quality to your to-dos, or **Show what raises Trust** to what would raise it. The nudge at the bottom shows only on your own steps.

Marked ready with steps skipped, it says how many are still open. **Next step** then offers **Export** and **Mark published**.

## The page's author

The header shows the page's author, picked from **Settings › Authors**, or your brand's team as the byline. The Content Agent can't add, edit or invent authors. For a page that advises on health, money or the law, the header also shows the qualified person who reviewed it.

## Before you publish

**Mark ready** opens **Before you publish** first. A line sums up what to fix and to check; the checks show in three groups: **Fix before you publish**, **Check yourself** and **In place**. They cover:

- placeholders, alt text and links (**Ready for your CMS**);
- the author, and the qualified reviewer on pages that advise on health, money or the law;
- visible dates;
- the search engine details (Article schema) GetCito adds;
- Trust under 60: AI answers may lean on the page less;
- the rules and to-dos still open. You can still mark it ready.

Copy and Export carry **Reviewed by** beside **Author** in the page metadata. Once the page's text names the reviewer, its structured data does too. On a shopping path page, it also names product cards whose catalog price changed since they went in. **Send to CMS** opens it only when it has something to ask about.

## Search engine details (Article schema)

An article goes to your CMS and to exports with search engine details, an Article schema, that name its author, or your brand when it has none. The page's text doesn't change. If your CMS adds its own, click **Leave it out**; **Add it back** undoes it. A page with an Article schema of its own gets none. WordPress leaves the schema out: add it with your SEO plugin.

## Export with Quality on

**Export** opens a dialog: the same files as without Quality, and under **Platforms** a copy of the page to paste into Webflow, WordPress, Shopify or Google Docs. A line over the options sums up **Before you publish**, and **Review** opens it.

If placeholders are still open, Export asks first: **Fill now**, or **Export without them**, which leaves out the sentences with a placeholder. One in the title or a heading has to be filled.
