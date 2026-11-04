---
name: questions
description: "Groups new buyer questions by topic, with volume and who AI recommends."
license: MIT
metadata:
  title: "Buyer questions"
  filters: "visibility product"
---

# Buyer questions

What buyers ask AI engines in the brand's category: the questions grouped by topic, how often they are searched, and which brand AI recommends for each, with the reason it gives.

## When to use

- "What do buyers ask AI about integrations?", "Which buyer questions came up this week?", "Product digest."
- For one competitor's side of things, the Rival brief skill fits better.

## What to read

1. `list_topics` and `list_prompts`: the brand's topics and the prompts under each, newest first when the person asks what's new.
2. `get_fanouts` for the prompts of the topic asked about: the questions engines search behind them.
3. `get_prompt_volumes`: how often each prompt is searched, where the volume is known.
4. `list_ai_answers` for those prompts: which brand each engine recommends, and the words it gives as the reason.
5. `list_prompt_suggestions`: questions the brand doesn't track yet.

## Steps

1. Take the topic the person names; with none, the topics with the most new prompts and fan-outs.
2. Group the questions by what the buyer wants to know, not by their wording. Merge near-duplicates.
3. For each group: its searches a month where known, the brand AI recommends most, and the reason it gives, quoted from an answer.
4. Mark the groups where no brand clearly leads: they are the easiest to win.
5. Close with what this means for the roadmap and the content plan, in three to five lines.

## Output

1. A table: Buyer question, Searches a month, AI recommends, Reason AI gives.
2. "What this means": three to five lines.
3. The untracked questions worth tracking, as a list the person can add with `add_prompts`; the app asks them first.

## Don't

- Never make up a volume: write "unknown" where none is known.
- Quote the reason AI gives; don't write your own.
- Don't say which product is better: report what AI says.
