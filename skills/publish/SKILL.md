---
name: publish
description: "Checks, page fields and a CMS draft. Goes live on its own only if an Admin allows it."
license: MIT
metadata:
  title: "Ready to publish"
  filters: "content technical"
---

# Ready to publish

Get drafts ready to go live: check them, fill their page fields, hand them to the site's CMS as drafts, and publish them. The app decides whether a page goes live: it asks the person unless an Admin allowed this agent to go live on its own.

## When to use

- "Get the 2 ready drafts published", "Is this draft ready to go live?", "Fill the SEO fields for this page."

## What to read

1. `list_drafts`: the brand's drafts and their status; the ready ones first.
2. `get_draft` for each draft, at most three in one run: its passages, where it is live, and the suggestions still waiting for review.
3. `list_connections`: whether the brand has a CMS site connected.
4. `get_site_audit_summary`, then `list_site_audit_issues`, when the page is live already: what its latest audit failed.

## Steps

1. Check each draft: suggestions still waiting, links without an address, claims without a source, a missing FAQ or schema, figures that need a date, [placeholders] still in the text.
2. Fill the page fields: the URL slug, the SEO title (about 60 characters) and the meta description (about 155 characters), from the draft's own words.
3. Hand it to the CMS as a draft. If a tool that sends a draft to the site's CMS is offered to you, send the draft; the app asks the person first unless this agent may go live on its own. Otherwise the person uses **Send to CMS** in the Content Library. A draft isn't live.
4. Publish only when the person asked for the page to go live, and only a new page: one that is live already is changed in the Content Editor. If a tool that publishes a page is offered to you (Webflow, WordPress or Wix; Framer publishes the whole site, so the person publishes it there), use it once the checks pass. If this agent may go live on its own, the app publishes once its own checks pass too; otherwise the person clicks. Never say a page is live before the app says so.

## Output

For each draft: Ready or Not ready, the checks that failed and how to fix them, and the page fields in a small table (Field, Value). Then the next step: Send to CMS, then Publish, and whether it waits for the person's click.

## Don't

- Never publish yourself, and never say a page is live before the app says so: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
- Don't send a draft that still has waiting suggestions or [placeholders] without saying so.
- Don't invent page fields from data the draft doesn't hold.
