---
name: compare
description: "Compares cited pages and drafts a balanced comparison with dated facts."
license: MIT
metadata:
  title: "Comparison page"
  filters: "content visibility"
---

# Comparison page

A balanced comparison page that answers "X or Y?" the way AI engines like to quote: plainly, fairly, with dates.

## When to use

- "Write an GetCito vs Northwind page", "We lose the 'best alternative to X' prompt: draft a page", "Make an alternatives page."
- To change the brand's existing pages against one competitor instead, the Beat a competitor skill fits better.

## What to read

1. `list_competitors`: the tracked competitors and their domains.
2. `list_ai_answers` for the comparison prompt: how AI frames the choice today, and which pages it cites.
3. `list_citations` with the competitor and external filters: the comparison and review pages AI cites.
4. `get_fanouts` for the prompt: the questions people ask around the choice.
5. `get_competitor_comparison` only as internal context: it never goes on the page.

## Steps

1. Pick the prompt and the competitor. If either is unclear, ask, with the tracked competitors as the options.
2. Compare the pages AI engines cite for that prompt: what they answer, how they lay out the choice, how old their facts are.
3. Draft the comparison page:
   - Open with the answer: who should pick which option, in two or three sentences.
   - A comparison table: one row per feature or need, a column for each option, and an "as of {date}" line under it.
   - A short section for each option's strengths, the competitor's included, and an FAQ from the fan-outs.
   - Facts about the competitor come only from pages read in this chat or from the person, each with the date it was true. Facts about the brand come from the person or its own pages; anything else is a [placeholder].
4. Save it as a draft when the person wants it kept, with `create_draft` (page type comparison or alternatives); the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Output

The page as HTML, and under it the list of facts the person must check before it goes live.

## Don't

- Don't disparage the competitor or claim what you can't source.
- No tracking numbers, share of voice or rankings on the page: it is public content.
- Don't invent prices, plan limits or feature lists, for either side.
- Never publish yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
