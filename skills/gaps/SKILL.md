---
name: gaps
description: "Finds prompts and segments where no brand leads yet, and suggests what to do."
license: MIT
metadata:
  title: "No clear leader"
  filters: "visibility product"
---

# No clear leader

The prompts, topics and segments where AI engines don't recommend one brand most of the time: open ground the brand can take first.

## When to use

- "Which use cases have no clear winner yet?", "Where is nobody leading?", "Unmet needs."
- To work on one prompt a competitor already wins, the Beat a competitor skill fits better.

## What to read

1. `list_topics` and `list_prompts`: the brand's topics and tracked prompts.
2. `get_prompt_performance`: the brand's place on each prompt, per engine.
3. `list_ai_answers` for the prompts: which brands each engine recommends.
4. `get_competitor_comparison`: where competitors lead, to tell an open prompt from a taken one.
5. `get_prompt_volumes`: how often each prompt is searched, where known.

## Steps

1. For each prompt, count which brands the engines recommend across its answers.
2. A prompt has no clear leader when no brand is recommended in most of its answers. Group these prompts by topic or segment.
3. Order them by searches a month where known, then by how close the brand already is.
4. For each, suggest one action: a page to write or update, a question to answer, a source to be listed on.
5. Offer to add the top ones to Action Center with `create_action`; the app asks the person first.

## Output

1. A table: Prompt or segment, Engines, Brands that appear, The brand's place, Searches a month, Suggested action.
2. The three to start with, and why.

## Don't

- Don't call a prompt won or lost from one answer: look across its answers and engines.
- Never make up a volume: write "unknown" where none is known.
- Never promise the brand will lead after an action.
