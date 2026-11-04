---
name: refresh
description: "Updates dates, numbers and examples from Sources; flags what needs the user."
license: MIT
metadata:
  title: "Refresh for this year"
  filters: "content"
---

# Refresh for this year

Bring an older page up to date: its dates, numbers and examples, without losing what AI engines already quote from it.

## When to use

- "Refresh our pricing guide for this year", "Which pages are out of date?", "Update this draft's numbers."
- When no page is named, list the drafts that changed longest ago and ask which one to refresh.

## What to read

1. `get_draft` for the page: its passages, the sources it cites, and which passages AI quotes now (locked).
2. `list_drafts` when no page is named: the drafts, latest changed first, to find the oldest.
3. `get_site_audit_summary`, then `list_site_audit_issues` for the page's latest audit: freshness, date markup and the other failed checks.
4. `list_ai_answers` for one or two prompts the page serves: what AI cites now, and what this page no longer answers.

## Steps

1. Find what is dated: years, "last year", figures, prices, screenshots described in the text, examples, product names that changed.
2. Update what a source supports: a figure or date from the page's own sources, the person's messages, or a page read in this chat. Each new number names its source.
3. Flag what needs the person: a figure no source supports stays as a [placeholder], such as [current customer count], in a to-do list.
4. Keep the passages AI quotes word for word, unless the person asks to change them and knows they are quoted.
5. Add an "Updated on [date]" line.

## Output

1. A table: Passage, What changed, Source (or "needs you").
2. The updated passages, ready to paste.
3. The to-do list of what only the person can supply.

When the person wants it kept, save it as a new version with `create_draft`, method optimize, with the live page's address as its source; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Don't

- Don't invent new facts or figures to make the page look fresh.
- Don't change a date on the page unless its content changed.
- Never publish yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
