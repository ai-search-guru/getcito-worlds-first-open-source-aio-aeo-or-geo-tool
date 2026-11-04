---
title: Send a page to your CMS
route: /dashboard/content/library
keywords: [send to cms, webflow, wordpress, framer, draft post, last send, qualified reviewer, reviewer metadata, reviewed by, take down, unpublish]
synonyms: [push to cms, publish to blog, send to website, export to cms, send reviewer, reviewer field]
plan: all
updated: 2026-11-04
last_checked: 2026-11-02
owner: GetCito maintainers
app_version: 0.3.0
approved: true
sources: [docs/guides/send-to-cms.mdx, docs/guides/content-editor.mdx]
---
**Send to CMS** sends a Content Editor page to your CMS: into a Webflow or Framer collection as a draft item, to your WordPress site or your Wix site's Blog as a draft post, or to your workflow tool, which creates the post in your CMS. Send to CMS never publishes: you publish in your CMS. Only admins and managers can send pages.

## Send one page

In the editor, click the paper-plane icon in the header. With Quality on, **Before you publish** opens first when it has something to ask about, such as a missing author, open placeholders, missing alt text or broken links. Check it and click **Continue to send**. From the Library, open a row's **…** menu and pick **Send to CMS**.

The dialog fills the **Slug**, **Meta title** and **Meta description** from the page; change them before sending if you like. For a regulated page, a selected qualified reviewer is sent separately from its author; the dialog shows both metadata lines. What you send is kept on the draft, so the next send starts from it.

## Choose where it goes

The dialog offers each CMS that is connected and ready, Webflow, WordPress, Framer, then Wix, beside **Your workflow**. Your choice is remembered for the brand in your browser.

A CMS that is connected but not ready shows what to fix and can't be picked, for example when its sign-in is refused or no collection is picked. If the dialog can't check a CMS you chose just then, the page goes to your workflow, and the dialog says so with **Try again**.

## What holds a send

The page goes as Export makes it, without its H1: your CMS's title field carries the title. GetCito holds the send while:

- a placeholder in square brackets is still open. **Fill now** selects the first one;
- the page has no title, or nothing under its title;
- the slug can't be used.

## Send several pages

In the Library, tick the rows to send, up to 25 at once, and click **Send to CMS** in the bar above the table. The dialog lists each page as **Ready**, or says why it can't go; a page that can't go is left out, so fix it in the editor. The pages go one after another in the background. You can close the dialog at any time: the Library keeps following them.

## See how a send went

Beside each row's status, the Library shows the last send: a clock while it's on its way, a paper plane once it's sent, a red warning when it failed (hover it to see why), a blue link once it's published (click it to open the live page), and a crossed-out cloud once it was taken down.

The **Last send** filter beside **Created** lists the pages that were **Never sent**, **Sending**, **Sent**, **Failed** or **Published**; a page taken down counts as **Sent**. A send to your workflow isn't retried on its own: send a failed page again from the Library.

## When a page becomes Published

Once you publish the item in Webflow or Framer, or the post in WordPress or Wix, the page becomes **Published** and its address shows in the Library. GetCito checks when you open the Library and once a day, for sends from the last 60 days. A page sent to your workflow becomes Published when the workflow reports where it went live. A page whose item or post you deleted reads as removed: send it again to make a new one.

## Take a published page down

A page published through GetCito in Webflow, WordPress or Wix can be taken down: pick **Take down** in its row's **…** menu. It leaves your site at once and goes back to a draft in your CMS, and the Library shows **Taken down** beside its status. Links to it, and AI answers that cited it, may still point to it for a while.

Admins and managers can take a page down, even when publishing is off for managers. A page someone took down never goes live on its own again: an agent's next publish of it waits for a click. Framer publishes the whole site, and a send to your workflow is your workflow's: take those down there.

## Sending a page again

Sending a page again updates the same Webflow or Framer item, the same WordPress draft post, or the same Wix post (a published one gets a new draft version in Wix). Changes to a published Webflow or Framer item go live with your next publish there. WordPress has no draft of a published post, so a page whose post is published, scheduled or private goes as a new draft post: move the text over in WordPress.

## What each CMS leaves out

- **Webflow**: Tables become lists; images aren't sent. Reviewer metadata requires a mapped optional Plain Text field; show it in the collection template. Empty meta descriptions use the page's opening words.
- **WordPress**: Reviewer metadata and structured data aren't sent; the adapter can't map custom metadata or repurpose the post author. Set the meta title and structured data in your SEO plugin. Images keep their addresses; no featured image or category is set.
- **Framer**: Tables stay tables; images aren't sent. Reviewer metadata requires a mapped optional string field; show it in the page template. Duplicate slugs stop the send.
- **Wix**: Images, cover images and categories aren't sent. Reviewer metadata is an SEO tag, not visible text; show it in the page template. Resending replaces post text, so add images after the last send.

Add images in your CMS. The slug may change slightly there: lowercase, without accents, with dots turned into dashes.

## The Article schema

An article goes with the Article schema GetCito adds, its author included, unless you left it out in **Before you publish**. WordPress doesn't take it: add it with your SEO plugin.
