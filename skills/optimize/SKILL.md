---
name: optimize
description: "Scores a page or draft against the pages AI cites and lists the changes that would get it cited."
license: MIT
metadata:
  title: "Optimize content"
  hidden: "true"
  reads: "fetch_page get_draft list_drafts list_citations list_prompts get_prompt_performance get_fanouts get_site_audit_summary list_site_audit_issues list_brands open_page"
---

# Optimize content

The playbook of the /optimize shortcut ("Optimize this page: …"): how one page or draft compares with what AI cites for its prompts, and the changes that would close the gap.

## Data plan

Read only these, for the page or draft the person names:

1. `fetch_page` for the page, or `get_draft` for a draft (`list_drafts` to find it by name).
2. `list_prompts` and `get_prompt_performance`: the tracked prompts the page should win.
3. `list_citations` for those prompts over the last 30 days, and `fetch_page` for the one or two pages AI cites most.
4. `get_fanouts`: what the engines search for behind those prompts.
5. `get_site_audit_summary` and `list_site_audit_issues`: the page's latest Site Audit result, when it has one.

Use `list_brands` only when no brand is selected, and `open_page` to link the Content Editor.

## Questions

- When no tracked prompt fits the page, ask which prompts it should win, with two to four of the closest as options.

## Steps

1. Score the page against the cited pages: does it answer the prompts directly, cover the fan-outs, carry structured data, and pass its audit checks?
2. List the changes, most impact first: what to change, where, and why AI would cite it after.
3. Write the changed passages, ready to paste, and the structured data as code.
4. When the person wants a draft changed, use `update_draft`; for a live page, save the new version with `create_draft`. The app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Output

A change list: Change, Where, Why it helps AI answers, then the rewritten passages.

## Next moves

Two or three, such as opening the page in the Content Editor, or generating its schema.

## Don't

- Never publish or change the live site: going live is always the person's click.
- Never promise rankings or citations.
