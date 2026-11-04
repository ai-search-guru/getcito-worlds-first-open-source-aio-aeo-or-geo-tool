---
name: features
description: "How AI describes you against each competitor, feature by feature, with quotes."
license: MIT
metadata:
  title: "How AI compares us"
  filters: "visibility product"
---

# How AI compares us

How AI engines describe the brand against each tracked competitor, feature by feature, in the engines' own words.

## When to use

- "Which features does AI name for Northwind but not for us?", "How does ChatGPT compare us with our rivals?"
- For a page that answers "X or Y?", the Comparison page skill fits better.

## What to read

1. `list_competitors`, and `get_competitor_comparison` for the period: who the brand is compared with, and where each leads.
2. `get_mention_competitors`: the competitors named beside the brand most often.
3. `list_mentions`, then `get_mention` for answers that name the brand and a competitor together: what each is praised or faulted for.
4. `get_mentions_perception`: what AI associates with the brand.

## Steps

1. Take the competitor the person names; with none, the two or three named beside the brand most.
2. List the features and qualities the answers name, for the brand and for each competitor.
3. For each one: who AI credits with it, with a short quote and its engine.
4. Mark the features AI names for a competitor but never for the brand, and anything AI says about the brand that looks wrong.

## Output

1. A table: Feature, the brand, one column per competitor, Quote and engine.
2. "Gaps": the features AI credits only to competitors, and what to check for each.
3. Claims about the brand that look wrong, for the person to confirm.

## Don't

- Don't decide which product is better: report what AI says.
- Never state what the brand offers from your own knowledge: ask the person.
- Don't disparage a competitor, and claim nothing about them an answer doesn't say.
