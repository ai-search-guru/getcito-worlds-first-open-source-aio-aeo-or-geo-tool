---
title: Manage drafts in the Content Library
route: /dashboard/content/library
keywords: [content library, drafts, draft status, archive, export drafts, made in, open chat, from chat]
synonyms: [content list, my articles, saved pages, draft list]
plan: all
updated: 2026-11-04
last_checked: 2026-10-31
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/content-editor.mdx]
---
The **Library**, under **Content** in the sidebar, lists every page you, your teammates and the Content Agent wrote or changed in GetCito. Click a row to open the draft in the editor.

## The tabs

Each tab shows its count:

- **All**: every draft that isn't archived.
- **In progress**: drafts being written.
- **In review**: drafts the Content Agent wrote, waiting for a person.
- **Ready**: drafts marked ready.
- **Published**: drafts marked published, by you or your CMS.
- **Archived**: drafts sent to the archive. They keep their status for when they're restored.

## Columns and filters

The columns are Content, Type, Method (Create or Optimize), By (you, the Content Agent or a teammate), Made in (Content Editor, Chat, Action Center, Agent or MCP), Status, Created and Updated. A draft made in your own chat has **Open chat**, and the editor shows **From chat** with its title. While the Content Agent writes a draft, its Status reads **Agent writing…**, and **Agent failed** if it couldn't finish; where your workspace has Chat, each comes with the same dot Chat shows for a run. The **Created** filter narrows the list to the last 7, 30 or 90 days, and **Made in** to one place, once drafts come from more than one. Once a page has been sent to your CMS, the **Last send** filter lists the pages by how their last send went: never sent, sending, sent, failed or published.

## The row menu

- **Status**: set the draft to In progress, In review, Ready or Published. Ready works like the editor's Mark ready, and Published, not offered for archived drafts, asks for the page's live address. Moving a ready or published draft back to In progress or In review opens its task again. A published one also opens the action's Publish task again and stops its Live page being measured for the action.
- **Export Word**, **Export Excel**, **Export CSV**, **Export HTML** or **Export Markdown** for that draft.
- **Send to CMS**: send the draft to your CMS, except an archived one. Admins and managers can tick several rows to send up to 25 at once.
- **Send to Archive** or **Restore**.
- **Delete**: the draft leaves the Library for good, with its versions and suggestions. An Action Center task it was sent as stays.

Send to CMS, archiving and deleting are for admins and managers.

## Export the list

**Export** in the header downloads the drafts listed, that is the current tab within the **Created** range and the **Last send** filter:

- **Export CSV** and **Export Excel**: one row per draft, with its title, status, method, page type, author, dates, page address, length and text.
- **Export Word**: one document, each draft starting on a page of its own.

## Shopping path check for online shops

For an online shop, the **Shopping path** column shows what the last check found for each draft with a shopping path. After each catalog sync, every such draft is read again. A draft needs attention when it links a product that is sold out, refused by Merchant Center or gone from your catalog; hover the mark to see the products. The **Shopping path** filter lists the drafts that need attention, are fine, or have none.

When a published page links a product that no longer sells, a **Fix** action opens in the Action Center, and **Swap in the editor** opens the draft.
