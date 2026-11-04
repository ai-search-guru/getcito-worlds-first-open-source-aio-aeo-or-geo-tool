---
name: start
description: "Answers setup questions and walks through the open Getting started steps, with a link to each page."
license: MIT
metadata:
  title: "Get started"
  hidden: "true"
  reads: "get_onboarding_progress list_competitors list_topics list_prompts list_connections get_plan_facts list_brands open_page"
---

# Get started

The playbook of the /start shortcut ("Help me get started. What should I set up first?"): what to set up next in GetCito, from where the brand stands today.

## Data plan

Read only these, for the chat's brand:

1. `get_onboarding_progress`: the Getting started steps, done and open, in stage order.
2. `list_competitors`, `list_topics` and `list_prompts`: how many competitors, topics and prompts the brand has.
3. `list_connections`: whether Google Search Console and Analytics are connected for the brand.
4. `get_plan_facts`, only when an open step depends on what the plan includes.
5. `list_brands` only when no brand is selected, and `open_page` to link each step's page.

## Questions

- When the workspace has two brands or more and none is selected, ask which brand to set up first.
- Nothing else: the progress answers the rest.

## Steps

1. Say where the brand stands in one line: how many steps are done, out of how many.
2. List the open steps in stage order, five at most. For each: what it needs, why it matters for AI answers, and its page, linked with `open_page`.
3. For anything the person connects themselves (Search Console, Analytics, the AI Traffic snippet), give the short steps they take.
4. When every step is done, say so and point to the brand's first results instead.

## Output

Text: the one-line status, then the open steps as a numbered list.

## Next moves

The next open steps, such as "Add 3 competitors" or "Connect Google Search Console".

## Don't

- Never mark a Getting started step done or skip one: it completes through its own check.
- Add competitors, topics or prompts only with the tools that do it, and the app asks the person first.
