---
name: faq
description: "An FAQ block from the top fan-outs and your brand facts, with FAQPage schema."
license: MIT
metadata:
  title: "FAQ from fan-outs"
  filters: "content visibility technical"
---

# FAQ from fan-outs

An FAQ block that answers the questions AI engines search for, and the FAQPage structured data that goes with it.

## When to use

- "Write an FAQ for our pricing page", "Add FAQ schema to this draft", "What questions should this page answer?"
- If the page or topic is unclear, ask which one first.

## What to read

1. `get_fanouts` for the brand, or the topic of the page: the searches the engines run behind its answers. These are the best questions.
2. `get_prompt_insights` or `list_prompts` for the topic: the prompts people ask, and where the demand is.
3. `list_ai_answers` for one or two of those prompts: what AI says now, and what it gets wrong or leaves out.
4. `get_draft` when the person names a draft: its passages, so the FAQ doesn't repeat them.

## Steps

1. Pick the top fan-outs for the page: 5 to 8 questions. Merge near-duplicates, and phrase each the way a buyer would ask it.
2. Write the answers from the brand's facts: 40 to 80 words each, the first sentence answering on its own. Use only facts from the person's messages, the brand's approved facts they give, its own pages read in this chat, or the draft. Any other fact is a [placeholder], such as [plan limits] or [support hours].
3. Save the FAQ and its FAQPage schema as a draft when the person wants it kept, with `create_draft`; the app asks them first when it should. In an agent's run nobody is there to ask: always save it with its tool, and the app holds it for approval where the agent's mode needs it.

## Output

1. The FAQ as HTML: a heading, then each question as a subheading with its answer.
2. The FAQPage structured data as JSON-LD, in a code block, repeating each question and answer exactly as the visible FAQ says them.
3. One line on where the questions came from (fan-outs, prompts).

## Don't

- No tracking numbers (visibility, share of voice, rankings) in the FAQ: it is public content.
- Don't invent prices, figures, customers or awards.
- Don't mark up questions and answers that aren't visible on the page.
