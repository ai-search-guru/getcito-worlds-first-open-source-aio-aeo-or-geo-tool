---
name: beat
description: "Compares your cited pages with theirs and drafts the changes."
license: MIT
metadata:
  title: "Beat a competitor"
  filters: "content visibility"
---

# Beat a competitor

On one prompt where a competitor wins, compare the pages AI engines cite for them with the brand's own, and draft the changes that close the gap.

## When to use

- "Help us beat Northwind on 'ai visibility tool'", "Why does ChatGPT pick them over us for this prompt?"
- For a new side-by-side page instead, the Comparison page skill fits better.

## What to read

1. `list_competitors`, and `get_competitor_comparison` for the period: where the competitor leads, per platform.
2. `get_prompt_performance` for the brand's prompts: the prompt where the gap is widest, if the person names none.
3. `list_ai_answers` for that prompt: which pages each engine cites, theirs and the brand's.
4. `list_citations` with the competitor and owned filters: the competitor's cited pages, and the brand's best page for the topic.
5. `get_fanouts` for the prompt: the questions behind it that the cited pages answer.
6. `get_draft` when the brand's page is a draft in the Content Library.

## Steps

1. Pick the prompt and the competitor. If either is unclear, ask, with the tracked competitors as the options.
2. Compare the cited pages: what the competitor's page answers that the brand's doesn't, how directly it answers, its tables, FAQs, dates and sources.
3. Write a gap table, then draft the changes to the brand's page: new or rewritten passages, each tied to a gap.
4. Save the changed page as a new version with `create_draft`, method optimize, with the live page's address as its source; the app asks the person first when it should.

## Output

1. A gap table: What the cited page does, The competitor, The brand, Change.
2. The drafted passages, ready to paste, with [placeholders] for facts only the brand can give.

## Don't

- Don't copy the competitor's text or structure: say what it answers, and answer it in the brand's own way.
- Don't disparage the competitor, and claim nothing about them a read page doesn't say.
- No tracking numbers on the page, and never claim the changes will win the prompt.
