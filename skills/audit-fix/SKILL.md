---
name: audit-fix
description: "Turns site audit findings into fixes you approve."
license: MIT
metadata:
  title: "Site audit fixes"
  filters: "content technical"
---

# Site audit fixes

The site audit's findings, ordered by what matters most for AI answers, each turned into a fix ready to apply.

## When to use

- "Fix our site audit", "What should we fix first for AI?", "Site audit fixes."
- To rewrite one page so AI quotes it, the Answer-first rewrite skill fits better.

## What to read

1. `get_site_audit_summary`: the latest audit, its date and its scores.
2. `list_site_audit_issues`: the findings, with the pages each one affects.
3. `fetch_page` for the pages behind the top findings: what is on them now.
4. `list_drafts` and `get_draft`: drafts already open for those pages.

## Steps

1. Start from the latest audit. When there is none, or it is old, offer `run_site_audit`; the app asks the person first. A page with an audit running gets that audit back, with no new audit used. A page audited in the last 10 minutes isn't started again: ask whether to open that audit or audit it again, and only then run it again with force.
2. Order the findings by what matters for AI answers: whether AI crawlers can reach the pages, then missing direct answers, structured data, titles and descriptions, then the rest.
3. For each of the top findings: why it matters for AI answers, and the fix, ready to apply: the corrected markup, text or setting.
4. When the person wants a page change kept, save it as a draft with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.
5. Settings outside the page, such as the robots file or the CMS, are the person's to change: write the change for them.

## Output

1. A table: Finding, Pages, Why it matters for AI, Fix, Effort.
2. The fixes, ready to paste.

## Don't

- Never change the site, and never publish yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
- Don't fix what the audit didn't find without saying so.
- Never promise rankings or citations.
