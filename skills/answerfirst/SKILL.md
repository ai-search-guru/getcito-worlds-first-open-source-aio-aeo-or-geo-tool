---
name: answerfirst
description: "Puts a direct answer under each H2 and an AI Overview summary on top."
license: MIT
metadata:
  title: "Answer-first rewrite"
  filters: "content"
---

# Answer-first rewrite

Turn sections that warm up slowly into ones that answer first, so an AI engine can lift them as they are.

## When to use

- "Make this page answer-first", "Rewrite our intro so AI quotes it", "Why doesn't AI quote this page?"
- For a whole page, work section by section, the summary first.

## What to read

1. `get_draft` when the person names a draft: its passages, and which ones AI quotes now (locked).
2. `list_prompts` or `get_fanouts` for the page's topic: the questions each section should answer.
3. When a live page is named, `get_site_audit_summary` and `list_site_audit_issues` for its latest audit: the direct-answer and bottom-line-up-front checks.

If the person pasted the text, work from it and read nothing else unless needed.

## Steps

1. Write a summary for the top of the page: two or three sentences that answer the page's main question, the way an AI Overview would.
2. Under each H2, put a direct answer first: one or two sentences, 50 words or fewer, that answer the heading on their own. Detail, reasons and caveats come after.
3. One question per section; its heading says the question or its answer.
4. Define a term where it is first used, in the same sentence. Steps as a numbered list, options as a table.
5. Keep every fact, figure and claim exactly as the source has it, and the brand's voice: change the order, not the personality. A passage AI quotes now stays word for word.

## Output

For each section: **Before**, **After**, and one line on what changed. Then the full rewritten text in one block, ready to paste. When the person wants it kept, save it as a new draft with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Don't

- Don't add facts, figures or promises that weren't in the text.
- Don't shorten an answer until it is no longer true.
- Don't touch locked passages without saying so.
