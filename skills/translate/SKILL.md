---
name: translate
description: "Translates a page into the user's markets, keeps rules and sources."
license: MIT
metadata:
  title: "Translate a page"
  filters: "content"
---

# Translate a page

Translate an existing draft into the languages of the brand's markets. Only the language changes: the facts, structure, sources and rules stay as they are.

## When to use

- "Translate /pricing to German and French", "Make a Turkish version of this draft."
- If the draft or the languages are unclear, ask which ones; offer the languages of the brand's tracked regions.

## What to read

1. `get_draft` for the draft: its passages, its sources, and which passages AI quotes (locked).
2. `list_brands` when the person names no language: the brand's region, for the language to offer first.

## Steps

1. Translate the draft passage by passage, into natural language for that market, not word for word.
2. Keep the structure: the same headings, lists, tables, FAQ and schema, translated.
3. Keep every fact, figure, date, name, product name and source exactly as the original has them. Units and date formats follow the market; the values don't change.
4. Keep links as they are, unless the person gives the addresses of the translated pages.
5. Save each language as its own draft with `create_draft`, the title in that language; the app asks the person first when it should.

## Output

For each language: the translated page, and a short list of what to check, such as terms that have no settled translation, or a passage that may need a local example.

## Don't

- Don't add, drop or change facts, claims or figures: translate only.
- Don't add local prices, offers or examples the original doesn't have.
- Never publish a translation yourself: the app decides whether a page goes live, and asks the person unless an Admin allowed this agent to go live on its own.
