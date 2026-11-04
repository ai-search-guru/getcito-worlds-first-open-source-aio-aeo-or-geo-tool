---
name: quality
description: "E-E-A-T, Trust and Readability fixes. Leaves only what you alone can give."
license: MIT
metadata:
  title: "Quality pass"
  filters: "content"
---

# Quality pass

Make the fixes a draft's Quality checks ask for (E-E-A-T, Trust and Readability), and leave a short list of what only the person can add.

## When to use

- "Run a quality pass on the drafts under 60", "Fix this draft's readability", "What does this draft still need?"
- The Quality tab in the Content Editor shows each draft's scores. When the person names no drafts, ask which ones, or list the drafts and let them pick.

## What to read

1. `list_drafts`: the brand's drafts, latest changed first.
2. `get_draft` for each draft you work on, at most three in one run: its passages, its sources, and which passages AI quotes (locked).

## Steps

1. For each draft, find what the checks look for:
   - **Readability:** sentences over about 25 words, paragraphs over about 5 sentences, jargon without a definition.
   - **Trust:** claims without a source, figures without a date, a missing disclosure where the brand compares itself or recommends its own product.
   - **E-E-A-T:** no author, no first-hand experience, no examples.
   - **Structure:** headings that don't say what the section answers, a missing FAQ or schema.
2. Fix what you can fix from the draft itself: split sentences, reorder, add headings, define terms, mark claims that need a source.
3. Give the fixes as **Before** and **After** for each passage. When the person wants them kept as a new draft, save it with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.
4. List what only the person can give: quotes, first-hand data, customer examples, the author and their credentials, sources for marked claims.

## Output

For each draft: the fixes made, then "Only you can add" as a short to-do list.

## Don't

- Don't invent quotes, authors, credentials, studies, customers or figures to pass a check.
- Keep the passages AI quotes word for word.
- Don't change what a passage claims: only how it says it.
