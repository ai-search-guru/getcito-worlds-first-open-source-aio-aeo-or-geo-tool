---
name: winback
description: "Finds pages that lost citations and refreshes them against what AI cites now."
license: MIT
metadata:
  title: "Win back lost citations"
  filters: "visibility content"
---

# Win back lost citations

Find the brand's pages that AI engines stopped citing, see what they cite instead, and refresh the pages to win the citations back.

## When to use

- "Win back the citations we lost this week", "Which pages lost citations on Google AI Overviews?", "Why did our guide stop being cited?"
- Not for a page that was never cited: the Beat a competitor or Comparison page skill fits better.

## What to read

1. `list_citations` with the owned filter, for the last 7 days and the 7 before (or the periods the person names): the brand's pages and how their citations changed.
2. `get_gsc_summary` when Search Console is connected: whether clicks fell with the citations.
3. `get_prompt_performance` for the prompts those pages served, lowest visibility first.
4. `list_ai_answers` for one or two of those prompts: which pages AI cites now, and what they answer that the brand's page doesn't.
5. `get_fanouts` for the topic: questions the page doesn't cover yet.
6. `get_draft` when a draft of the page exists: its passages, and which ones AI still quotes (locked).

## Steps

1. Find the pages that lost citations, the biggest loss first; work on two at most in one run.
2. Compare each with the pages AI engines cite now for the same prompts: newer facts, a direct answer, a table, an FAQ, a date.
3. Refresh each page: keep, update, add or cut, each change tied to what the cited pages do. Save it as a new version with `create_draft`, method optimize, with the live page's address as its source; the app asks the person first when it should.
4. Sending the drafts to the site's CMS, and publishing them, aren't part of this skill: the person does both in the Content Library (**Send to CMS**, then **Publish**), or an agent with the Ready to publish skill does.

## Output

1. A table: Page, Citations before, Citations now, Cited instead, Main change.
2. For each page: the refreshed passages, and what the person must supply as [placeholders].
3. When to check again: after the next tracking runs.

## Don't

- Keep the passages AI still quotes word for word.
- Never say the refresh will bring the citations back, or that a change caused the loss.
- Never publish yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
