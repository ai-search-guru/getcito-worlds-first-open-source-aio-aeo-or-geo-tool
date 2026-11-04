---
title: Use the Content plan
route: /dashboard/content/plan
keywords: [content plan, priority list, priority score, create optimize protect, losing ground]
synonyms: [what to write next, content roadmap, content priorities, editorial plan]
plan: all
updated: 2026-10-29
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
The **Content plan**, **Plan** under **Content** in the sidebar, ranks what to create, optimize or protect next. It covers the last 7, 30 or 90 days: pick the period at the top right.

## The four cards

- **Create**: new pages AI needs, that is open opportunities with no page on your site yet.
- **Optimize**: pages losing ground, and opportunities to improve a page you already have.
- **Protect**: your top pages, cited at least five times in the period and not losing ground, up to five, and opportunities to defend a page.
- **Priority**: rows your team marked as a priority.

Click a card to filter the list to it, and click it again to clear the filter.

## When a page is losing ground

A page is losing ground when it is cited at least 20% less per tracked answer than in the period before, from at least three citations. Because the comparison is per tracked answer, a week with fewer runs, or prompts added or removed, doesn't move a page. If tracking began during the earlier period, a note above the list says so.

## The priority list

Each row shows the **Priority Score**; the **Page**, with its title, page type and path, or **New page**; the **Action**: Create, Optimize or Protect; **Why** it's listed, tagged with where that comes from (**Opportunity**, **Citations** or **Protect**); and **Who** is on it: you, the Agent, a teammate or the person it's assigned to.

The row's button, **Create**, **Optimize** or **View**, opens New content on that row, and **Open draft** opens the draft already being written. Rows marked as a priority come first, the rest by score. The list shows up to 50 rows.

## How the Priority Score works

The score runs from 0 to 100 and is built from four factors:

- **Severity**: how urgent the row is. A page losing citations counts most, then a new page AI needs, a page to improve and a page to protect.
- **Opportunity**: the score of the content opportunity behind the row.
- **Page value**: the page's AI visits and, with conversions on, the conversions from AI journeys through it.
- **Citations**: how often AI answers cited the page.

A row without an opportunity, a new page, or a brand with no AI traffic data counts as neutral, not zero. Hover the score to see **How this score is worked out**. Only a page losing citations can reach critical.

## The row menu

- **Assign to…**: for a row with a draft, pick a teammate and the draft goes to the Action Center as their task. For a row without one, New content opens with **Team** chosen.
- **Mark as priority** or **Remove priority**: the row moves to the top of the list, tagged **Priority**. **Send to Plan** on an opportunity does the same.
- **Hide from the plan**: the row leaves the list and the counts. Undo it from the message that appears, or later from the hidden rows under the list, with **Show again**.

Only admins and managers can mark priorities and hide rows.

## What AI cites in your topics

A line above the list shows what visitors from AI assistants did on your site in the period: visits and, with Google Analytics connected, key events, orders and revenue.

Under **What AI cites in your topics**, click **Show**. For each page type, it compares the share of AI citations that go to that type with its share of your own cited pages. A type AI cites 10 points or more beyond your own mix is marked as a **Gap**. Click a row to filter the priority list to that page type; click it again, or **Clear**, to remove the filter. The page types follow your brand's **Site type** in the brand settings.

## Shopping opportunities

For an online shop whose product catalog, in **Settings › Integrations**, has categories, **Shopping opportunities** above the list shows two kinds of rows:

- **Buying guide · New**: a category with at least three products in stock that no page of yours guides shoppers to yet. **Create** starts a buying guide draft and opens it in the editor.
- **Existing post · Fix**: a published post that links a product that no longer sells, or misses some of its category pages. **Optimize** opens it in the editor.
